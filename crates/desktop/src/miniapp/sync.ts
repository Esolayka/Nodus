// Ties the API client, the offline cache, and the write queue together.
// This is the one place that decides what "save" actually means at any
// given moment: straight through to the server, queued for later, or a
// keep-both conflict — never a silent overwrite either way.

import type { SearchFileResult, TagCount, TaskRow, TreeNode } from "../types/vault";
import * as api from "./api/client";
import { allQueuedWrites, getCachedNote, putCachedNote, queueWrite, removeQueuedWrite } from "./offline/cache";
import { useLinkStore } from "./store/linkStore";

// Small, whole-document lists (the tree, tags, tasks) are cheap enough to
// just keep the last-known copy in localStorage — reused so the note list
// isn't blank the moment the phone loses signal, no IndexedDB needed for
// something this small.
function readListCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`nodus-miniapp:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeListCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`nodus-miniapp:${key}`, JSON.stringify(value));
  } catch {
    // Best-effort only — a full localStorage just means no offline list
    // cache this time, not a broken app.
  }
}

async function withListCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const value = await fetcher();
    writeListCache(key, value);
    useLinkStore.getState().setStatus("synced");
    return value;
  } catch (err) {
    if (api.isOffline(err)) {
      useLinkStore.getState().setStatus("offline");
      const cached = readListCache<T>(key);
      if (cached) return cached;
    }
    throw err;
  }
}

export const readTree = (): Promise<TreeNode> => withListCache("tree", api.fetchTree);
export const readTags = (): Promise<TagCount[]> => withListCache("tags", api.fetchTags);
export const readTasks = (): Promise<TaskRow[]> => withListCache("tasks", api.fetchTasks);
export const readSearch = (query: string): Promise<SearchFileResult[]> =>
  withListCache(`search:${query}`, () => api.fetchSearch(query));

export async function readNote(path: string): Promise<{ content: string; hash: string | null }> {
  try {
    const { content, hash } = await api.fetchNote(path);
    await putCachedNote(path, content, hash);
    useLinkStore.getState().setStatus("synced");
    return { content, hash };
  } catch (err) {
    if (api.isOffline(err)) {
      useLinkStore.getState().setStatus("offline");
      const cached = await getCachedNote(path);
      if (cached) return { content: cached.content, hash: cached.hash };
    }
    throw err;
  }
}

function conflictSiblingPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  const date = new Date().toISOString().slice(0, 10);
  return `${stem} (phone, ${date})${ext}`;
}

export interface SaveOutcome {
  status: "saved" | "queued" | "conflict";
  hash?: string;
  conflictSiblingPath?: string;
}

/** `baseHash` is whatever hash the note had when this edit started —
 * `null` only for a genuinely new note. Passing the wrong (stale) hash on
 * purpose isn't a shortcut to "force" a save; the server always wins that
 * argument, which is the whole point. */
export async function saveNote(path: string, content: string, baseHash: string | null): Promise<SaveOutcome> {
  try {
    const result = await api.writeNote(path, content, baseHash);
    if (result.ok) {
      await putCachedNote(path, content, result.hash);
      useLinkStore.getState().setStatus("synced");
      return { status: "saved", hash: result.hash };
    }
    await putCachedNote(path, result.conflict.currentContent, result.conflict.currentHash);
    const siblingPath = conflictSiblingPath(path);
    await putCachedNote(siblingPath, content, "");
    await queueWrite(siblingPath, content, null);
    useLinkStore.getState().setStatus("conflict");
    return { status: "conflict", conflictSiblingPath: siblingPath };
  } catch (err) {
    if (api.isOffline(err)) {
      await putCachedNote(path, content, baseHash ?? "");
      await queueWrite(path, content, baseHash);
      useLinkStore.getState().setStatus("offline");
      return { status: "queued" };
    }
    throw err;
  }
}

/** Replays queued offline writes in order. Stops (rather than churning
 * forever) the moment it hits another network failure, so it naturally
 * picks back up next time it's called — on an `online` event, or the
 * periodic retry while the status stays "offline". */
export async function flushQueue(): Promise<{ flushed: number; conflicts: number }> {
  const queued = await allQueuedWrites();
  let flushed = 0;
  let conflicts = 0;

  for (const item of queued) {
    try {
      const result = await api.writeNote(item.path, item.content, item.baseHash);
      if (result.ok) {
        await putCachedNote(item.path, item.content, result.hash);
        flushed += 1;
      } else {
        await putCachedNote(item.path, result.conflict.currentContent, result.conflict.currentHash);
        const siblingPath = conflictSiblingPath(item.path);
        await putCachedNote(siblingPath, item.content, "");
        await queueWrite(siblingPath, item.content, null);
        conflicts += 1;
      }
      if (item.id !== undefined) await removeQueuedWrite(item.id);
    } catch (err) {
      if (api.isOffline(err)) break;
      // Some other server-side rejection (e.g. the path became invalid) —
      // drop it rather than retry forever on something that can't succeed.
      if (item.id !== undefined) await removeQueuedWrite(item.id);
    }
  }

  if (flushed + conflicts > 0) {
    useLinkStore.getState().setStatus(conflicts > 0 ? "conflict" : "synced");
  }
  return { flushed, conflicts };
}

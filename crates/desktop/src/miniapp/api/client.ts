// Talks to the desktop's local-mode HTTP server (`nodus_core::local_server`)
// over the tunnel — the Mini App's only source of vault data in local
// mode. Every function throws `ApiError`; callers decide whether that
// means "queue it for later" (network failure) or "show the user an
// error" (anything else).

import type { SearchFileResult, TagCount, TaskRow, TreeNode } from "../../types/vault";
import { useLinkStore } from "../store/linkStore";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 0 means "never reached the network at all" — the caller's cue to queue
 * the request rather than surface it as a real error. */
export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const { baseUrl, sessionToken } = useLinkStore.getState();
  if (!baseUrl || !sessionToken) throw new ApiError(401, "not linked");

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}), Authorization: `Bearer ${sessionToken}` },
    });
  } catch {
    throw new ApiError(0, "network unreachable");
  }

  if (resp.status === 401) {
    useLinkStore.getState().unlink();
    throw new ApiError(401, "session expired — please relink");
  }
  return resp;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await request(path, init);
  if (!resp.ok) throw new ApiError(resp.status, await resp.text().catch(() => resp.statusText));
  return (await resp.json()) as T;
}

export function fetchTree(): Promise<TreeNode> {
  return requestJson("/vault/tree");
}

export interface NoteContent {
  content: string;
  hash: string;
}

export function fetchNote(path: string): Promise<NoteContent> {
  return requestJson(`/vault/note?path=${encodeURIComponent(path)}`);
}

export interface WriteConflict {
  currentContent: string;
  currentHash: string;
}

export type WriteResult = { ok: true; hash: string } | { ok: false; conflict: WriteConflict };

export async function writeNote(path: string, content: string, baseHash: string | null): Promise<WriteResult> {
  const resp = await request("/vault/note", {
    method: "PUT",
    body: JSON.stringify({ path, content, baseHash }),
  });
  if (resp.status === 409) {
    return { ok: false, conflict: (await resp.json()) as WriteConflict };
  }
  if (!resp.ok) throw new ApiError(resp.status, await resp.text().catch(() => resp.statusText));
  const body = (await resp.json()) as { hash: string };
  return { ok: true, hash: body.hash };
}

export function fetchSearch(query: string): Promise<SearchFileResult[]> {
  return requestJson(`/vault/search?q=${encodeURIComponent(query)}`);
}

export function fetchTags(): Promise<TagCount[]> {
  return requestJson("/vault/tags");
}

export function fetchTasks(): Promise<TaskRow[]> {
  return requestJson("/vault/tasks");
}

export async function toggleTask(
  path: string,
  markerStart: number,
  markerEnd: number,
  expectedMarker: string,
  addCompletionDate: boolean,
): Promise<void> {
  await request("/vault/tasks/toggle", {
    method: "PUT",
    body: JSON.stringify({ path, markerStart, markerEnd, expectedMarker, addCompletionDate }),
  });
}

/** Images/PDF/audio can't attach an Authorization header the way a plain
 * `<img src>` works, and a `?token=` query param would leak the session
 * token into logs/history — so attachments are fetched properly and
 * turned into a short-lived local object URL instead. Callers must
 * `URL.revokeObjectURL` it when done (e.g. on unmount). */
export async function loadAttachmentBlobUrl(path: string): Promise<string> {
  const resp = await request(`/vault/attachment?path=${encodeURIComponent(path)}`);
  if (!resp.ok) throw new ApiError(resp.status, await resp.text().catch(() => resp.statusText));
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

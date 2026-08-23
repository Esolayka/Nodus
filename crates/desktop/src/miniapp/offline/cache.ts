// The local cache a note is read from first (so the note screen opens
// instantly and works offline at all), plus the queue of edits made while
// offline, replayed once connectivity returns. Conflicts on replay are
// resolved exactly like the rest of the app: both versions kept, never a
// silent overwrite.

import { dbDelete, dbGet, dbGetAll, dbPut, STORE_NOTES, STORE_QUEUE } from "./db";

export interface CachedNote {
  path: string;
  content: string;
  hash: string;
  updatedAt: number;
  lastAccessedAt: number;
}

export interface QueuedWrite {
  id?: number;
  path: string;
  content: string;
  baseHash: string | null;
  queuedAt: number;
}

export async function getCachedNote(path: string): Promise<CachedNote | undefined> {
  const note = await dbGet<CachedNote>(STORE_NOTES, path);
  if (note) {
    note.lastAccessedAt = Date.now();
    await dbPut(STORE_NOTES, note);
  }
  return note;
}

export async function putCachedNote(path: string, content: string, hash: string): Promise<void> {
  const now = Date.now();
  await dbPut(STORE_NOTES, { path, content, hash, updatedAt: now, lastAccessedAt: now } satisfies CachedNote);
}

export async function deleteCachedNote(path: string): Promise<void> {
  await dbDelete(STORE_NOTES, path);
}

export async function allCachedNotes(): Promise<CachedNote[]> {
  return dbGetAll<CachedNote>(STORE_NOTES);
}

/** Cache size limit: "recent" evicts the least-recently-opened notes past
 * `maxEntries`; "all" never evicts anything. Run opportunistically after
 * every cache write, not on a timer — there's no background process to
 * run one in a browser tab that might not even be open. */
export async function enforceCacheLimit(mode: "all" | "recent", maxEntries: number): Promise<void> {
  if (mode === "all") return;
  const notes = await allCachedNotes();
  if (notes.length <= maxEntries) return;
  const sorted = [...notes].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  const toEvict = sorted.slice(maxEntries);
  await Promise.all(toEvict.map((n) => deleteCachedNote(n.path)));
}

export async function queueWrite(path: string, content: string, baseHash: string | null): Promise<void> {
  await dbPut(STORE_QUEUE, { path, content, baseHash, queuedAt: Date.now() } satisfies QueuedWrite);
}

export async function allQueuedWrites(): Promise<QueuedWrite[]> {
  return dbGetAll<QueuedWrite>(STORE_QUEUE);
}

export async function removeQueuedWrite(id: number): Promise<void> {
  await dbDelete(STORE_QUEUE, id);
}

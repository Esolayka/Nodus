import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UsageEntry {
  lastOpened: number;
  count: number;
}

interface NoteUsageState {
  usage: Record<string, UsageEntry>;
  recordOpen: (path: string) => void;
  rename: (oldPath: string, newPath: string) => void;
}

/** Recency/frequency signal for wikilink-autocomplete ranking — how
 * recently and how often each note has been opened. Persisted so "recently
 * opened" survives a restart, matching what a user actually expects that
 * phrase to mean. */
export const useNoteUsageStore = create<NoteUsageState>()(
  persist(
    (set) => ({
      usage: {},
      recordOpen: (path) =>
        set((s) => {
          const prev = s.usage[path];
          return {
            usage: {
              ...s.usage,
              [path]: { lastOpened: Date.now(), count: (prev?.count ?? 0) + 1 },
            },
          };
        }),
      rename: (oldPath, newPath) =>
        set((s) => {
          const prev = s.usage[oldPath];
          if (!prev) return s;
          const { [oldPath]: _removed, ...rest } = s.usage;
          return { usage: { ...rest, [newPath]: prev } };
        }),
    }),
    {
      name: "nodus:note-usage",
      version: 1,
    },
  ),
);

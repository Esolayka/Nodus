import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UsageEntry {
  lastUsed: number;
}

interface CommandUsageState {
  usage: Record<string, UsageEntry>;
  recordUse: (id: string) => void;
}

/** Recency signal for the command palette — "recently used commands rise
 * to the top." Persisted so it survives a restart. */
export const useCommandUsageStore = create<CommandUsageState>()(
  persist(
    (set) => ({
      usage: {},
      recordUse: (id) =>
        set((s) => ({
          usage: { ...s.usage, [id]: { lastUsed: Date.now() } },
        })),
    }),
    {
      name: "nodus:command-usage",
      version: 1,
    },
  ),
);

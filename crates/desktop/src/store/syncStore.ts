import { create } from "zustand";
import * as api from "../api/vault";
import type { FileChange, GitCredentials, MergeSegment } from "../types/vault";

export type SyncStatus = "idle" | "syncing" | "error" | "conflict";

export interface SyncLogEntry {
  id: number;
  time: number;
  level: "info" | "error";
  message: string;
}

let nextLogId = 1;

interface SyncState {
  /** Whether Git sync has been turned on (and successfully opened) for the
   * currently open vault this session. */
  enabled: boolean;
  status: SyncStatus;
  lastError: string | null;
  changes: FileChange[];
  /** Paths still carrying unresolved conflicts from the last merge attempt. */
  conflictPaths: string[];
  /** Credentials held in memory only for this session — never persisted to
   * settings, so a token or passphrase never touches disk unencrypted. */
  credentials: GitCredentials;
  log: SyncLogEntry[];
  detailsOpen: boolean;

  setCredentials: (credentials: GitCredentials) => void;
  setDetailsOpen: (open: boolean) => void;
  clearLog: () => void;

  enableGit: (vaultPath: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  commit: (message: string, authorName: string, authorEmail: string) => Promise<void>;
  addRemote: (name: string, url: string) => Promise<void>;
  pull: (remote: string, branch: string) => Promise<void>;
  push: (remote: string, branch: string) => Promise<void>;
  conflictSegments: (path: string) => Promise<MergeSegment[]>;
  finalizeResolvedMerge: (branch: string, resolutions: Record<string, string>) => Promise<void>;
  reset: () => void;
}

function appendLog(log: SyncLogEntry[], level: SyncLogEntry["level"], message: string): SyncLogEntry[] {
  const entry: SyncLogEntry = { id: nextLogId++, time: Date.now(), level, message };
  return [entry, ...log].slice(0, 200);
}

export const useSyncStore = create<SyncState>((set, get) => ({
  enabled: false,
  status: "idle",
  lastError: null,
  changes: [],
  conflictPaths: [],
  credentials: { kind: "none" },
  log: [],
  detailsOpen: false,

  setCredentials: (credentials) => set({ credentials }),
  setDetailsOpen: (open) => set({ detailsOpen: open }),
  clearLog: () => set({ log: [] }),

  reset: () =>
    set({
      enabled: false,
      status: "idle",
      lastError: null,
      changes: [],
      conflictPaths: [],
      log: [],
    }),

  enableGit: async (vaultPath) => {
    try {
      await api.gitEnable(vaultPath);
      set((s) => ({ enabled: true, log: appendLog(s.log, "info", "Git sync enabled for this vault.") }));
      await get().refreshStatus();
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
    }
  },

  refreshStatus: async () => {
    if (!get().enabled) return;
    try {
      const changes = await api.gitStatus();
      set((s) => ({
        changes,
        status: s.conflictPaths.length > 0 ? "conflict" : "idle",
        lastError: null,
      }));
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
    }
  },

  commit: async (message, authorName, authorEmail) => {
    set({ status: "syncing" });
    try {
      const oid = await api.gitCommit(message, authorName, authorEmail);
      set((s) => ({
        log: appendLog(s.log, "info", oid ? `Committed ${oid.slice(0, 8)}.` : "Nothing to commit."),
      }));
      await get().refreshStatus();
    } catch (err) {
      const errMessage = String(err);
      set((s) => ({ status: "error", lastError: errMessage, log: appendLog(s.log, "error", errMessage) }));
    }
  },

  addRemote: async (name, url) => {
    try {
      await api.gitAddRemote(name, url);
      set((s) => ({ log: appendLog(s.log, "info", `Remote "${name}" set to ${url}.`) }));
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
    }
  },

  pull: async (remote, branch) => {
    set({ status: "syncing" });
    try {
      const { credentials } = get();
      await api.gitFetch(remote, branch, credentials);
      const outcome = await api.gitMergeAfterFetch(branch);
      if (outcome.kind === "conflicts") {
        set((s) => ({
          status: "conflict",
          conflictPaths: outcome.paths,
          log: appendLog(s.log, "error", `Pull produced ${outcome.paths.length} conflict(s).`),
        }));
      } else {
        set((s) => ({
          conflictPaths: [],
          log: appendLog(
            s.log,
            "info",
            outcome.kind === "upToDate"
              ? "Already up to date."
              : outcome.kind === "fastForwarded"
                ? "Pulled (fast-forward)."
                : "Pulled and merged.",
          ),
        }));
      }
      await get().refreshStatus();
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
    }
  },

  push: async (remote, branch) => {
    set({ status: "syncing" });
    try {
      const { credentials } = get();
      await api.gitPush(remote, branch, credentials);
      set((s) => ({ log: appendLog(s.log, "info", `Pushed to ${remote}/${branch}.`) }));
      await get().refreshStatus();
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
    }
  },

  conflictSegments: (path) => api.gitConflictSegments(path),

  finalizeResolvedMerge: async (branch, resolutions) => {
    try {
      await api.gitFinalizeResolvedMerge(branch, resolutions);
      set((s) => ({
        conflictPaths: s.conflictPaths.filter((p) => !(p in resolutions)),
        log: appendLog(s.log, "info", "Merge conflicts resolved."),
      }));
      await get().refreshStatus();
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
      throw err;
    }
  },
}));

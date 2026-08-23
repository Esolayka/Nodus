import { create } from "zustand";
import * as api from "../api/vault";
import type { PairCompleteResponse, StorageUsage, SyncReport } from "../types/vault";

export type ServerSyncStatus = "idle" | "syncing" | "error";

export interface ServerSyncLogEntry {
  id: number;
  time: number;
  level: "info" | "error";
  message: string;
}

let nextLogId = 1;

function appendLog(
  log: ServerSyncLogEntry[],
  level: ServerSyncLogEntry["level"],
  message: string,
): ServerSyncLogEntry[] {
  const entry: ServerSyncLogEntry = { id: nextLogId++, time: Date.now(), level, message };
  return [entry, ...log].slice(0, 200);
}

interface ServerSyncState {
  enabled: boolean;
  status: ServerSyncStatus;
  lastError: string | null;
  lastReport: SyncReport | null;
  storageUsage: StorageUsage | null;
  log: ServerSyncLogEntry[];
  detailsOpen: boolean;

  setDetailsOpen: (open: boolean) => void;
  clearLog: () => void;
  reset: () => void;

  enable: (vaultPath: string, baseUrl: string, token: string, deviceName: string) => Promise<void>;
  syncOnce: () => Promise<void>;
  pairStart: () => Promise<{ code: string; expiresAt: number }>;
  pairComplete: (baseUrl: string, code: string, deviceName: string) => Promise<PairCompleteResponse>;
  refreshStorageUsage: () => Promise<void>;
}

export const useServerSyncStore = create<ServerSyncState>((set, get) => ({
  enabled: false,
  status: "idle",
  lastError: null,
  lastReport: null,
  storageUsage: null,
  log: [],
  detailsOpen: false,

  setDetailsOpen: (open) => set({ detailsOpen: open }),
  clearLog: () => set({ log: [] }),
  reset: () =>
    set({ enabled: false, status: "idle", lastError: null, lastReport: null, storageUsage: null, log: [] }),

  enable: async (vaultPath, baseUrl, token, deviceName) => {
    try {
      await api.serverSyncEnable(vaultPath, baseUrl, token, deviceName);
      set((s) => ({ enabled: true, log: appendLog(s.log, "info", "Server sync enabled for this vault.") }));
      await get().refreshStorageUsage();
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
    }
  },

  syncOnce: async () => {
    if (!get().enabled) return;
    set({ status: "syncing" });
    try {
      const report = await api.serverSyncOnce();
      const parts: string[] = [];
      if (report.uploaded.length) parts.push(`${report.uploaded.length} uploaded`);
      if (report.downloaded.length) parts.push(`${report.downloaded.length} downloaded`);
      if (report.deletedLocally.length) parts.push(`${report.deletedLocally.length} deleted locally`);
      if (report.deletedRemotely.length) parts.push(`${report.deletedRemotely.length} deleted remotely`);
      if (report.conflicts.length) parts.push(`${report.conflicts.length} conflict(s) resolved`);
      set((s) => ({
        status: "idle",
        lastError: null,
        lastReport: report,
        log: appendLog(s.log, "info", parts.length > 0 ? parts.join(", ") : "Already up to date."),
      }));
    } catch (err) {
      const message = String(err);
      set((s) => ({ status: "error", lastError: message, log: appendLog(s.log, "error", message) }));
    }
  },

  pairStart: () => api.serverSyncPairStart(),
  pairComplete: (baseUrl, code, deviceName) => api.serverSyncPairComplete(baseUrl, code, deviceName),

  refreshStorageUsage: async () => {
    if (!get().enabled) return;
    try {
      const storageUsage = await api.serverSyncStorageUsage();
      set({ storageUsage });
    } catch {
      // Non-critical — the panel just won't show a quota bar this time.
    }
  },
}));

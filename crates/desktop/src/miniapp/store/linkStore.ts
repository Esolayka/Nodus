import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SyncStatus = "synced" | "syncing" | "offline" | "error" | "conflict";

interface LinkState {
  baseUrl: string;
  sessionToken: string;
  telegramUserId: number | null;
  linked: boolean;
  status: SyncStatus;
  lastError: string | null;

  setLink: (baseUrl: string, sessionToken: string, telegramUserId: number) => void;
  setBaseUrl: (baseUrl: string) => void;
  setStatus: (status: SyncStatus, error?: string | null) => void;
  unlink: () => void;
}

export const useLinkStore = create<LinkState>()(
  persist(
    (set) => ({
      baseUrl: "",
      sessionToken: "",
      telegramUserId: null,
      linked: false,
      status: "offline",
      lastError: null,

      setLink: (baseUrl, sessionToken, telegramUserId) =>
        set({ baseUrl, sessionToken, telegramUserId, linked: true, status: "synced", lastError: null }),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setStatus: (status, error) => set({ status, lastError: error ?? null }),
      unlink: () => set({ baseUrl: "", sessionToken: "", telegramUserId: null, linked: false, status: "offline" }),
    }),
    { name: "nodus-miniapp:link" },
  ),
);

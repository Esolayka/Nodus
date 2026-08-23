import { create } from "zustand";
import { getBookmarks, setBookmarks } from "../api/vault";

/** Internal cache for the bookmarks plugin API (`PluginContext.vault`) —
 * not exported for direct use elsewhere. Bookmarks themselves live in
 * `.nodus/bookmarks.json` inside the vault (so they travel through sync
 * like everything else); this is just an in-memory mirror so the UI
 * doesn't wait on a round-trip for every read. */
interface BookmarksCacheState {
  paths: string[];
  loadedForVault: string | null;
  ensureLoaded: (vaultPath: string | null) => void;
  toggle: (path: string) => Promise<void>;
}

export const useBookmarksCacheStore = create<BookmarksCacheState>((set, get) => ({
  paths: [],
  loadedForVault: null,
  ensureLoaded: (vaultPath) => {
    if (!vaultPath || get().loadedForVault === vaultPath) return;
    set({ loadedForVault: vaultPath, paths: [] });
    void getBookmarks().then((paths) => {
      if (get().loadedForVault === vaultPath) set({ paths });
    });
  },
  toggle: async (path) => {
    const current = get().paths;
    const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
    set({ paths: next });
    await setBookmarks(next);
  },
}));

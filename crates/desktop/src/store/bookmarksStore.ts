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
  add: (path: string) => Promise<void>;
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
  add: async (path) => {
    // The title-bar menu can be used before the bookmarks panel has ever
    // mounted, so read the persisted list instead of assuming the cache is
    // already warm and accidentally replacing existing bookmarks.
    const current = await getBookmarks();
    if (current.includes(path)) {
      set({ paths: current });
      return;
    }
    const next = [...current, path];
    await setBookmarks(next);
    set({ paths: next });
  },
  toggle: async (path) => {
    const current = get().paths;
    const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
    set({ paths: next });
    await setBookmarks(next);
  },
}));

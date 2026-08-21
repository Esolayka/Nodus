import { create } from "zustand";

export type RightPanelTab = "outline" | "backlinks" | "graph";
export type SidebarView = "files" | "search" | "tags";
export type SearchPanelMode = "search" | "replace";

interface UiState {
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;

  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;

  /** The search panel's live query — a store field (not local component
   * state) so clicking a tag elsewhere in the app can switch to the search
   * panel with `tag:name` already filled in. */
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchPanelMode: SearchPanelMode;
  setSearchPanelMode: (mode: SearchPanelMode) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  quickSwitcherOpen: boolean;
  setQuickSwitcherOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  /** Opens the search panel pre-filled with a query — used by "click a tag
   * to search for it" both in the tags panel and inline in the editor. */
  openSearchWithQuery: (query: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  rightPanelTab: "outline",
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  sidebarView: "files",
  setSidebarView: (view) => set({ sidebarView: view }),
  sidebarCollapsed: false,
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchPanelMode: "search",
  setSearchPanelMode: (mode) => set({ searchPanelMode: mode }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  quickSwitcherOpen: false,
  setQuickSwitcherOpen: (open) => set({ quickSwitcherOpen: open }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  openSearchWithQuery: (query) =>
    set({
      sidebarView: "search",
      sidebarCollapsed: false,
      searchPanelMode: "search",
      searchQuery: query,
    }),
}));

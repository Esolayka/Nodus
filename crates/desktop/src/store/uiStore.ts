import { create } from "zustand";

/** The 4 built-in tabs, plus any plugin-registered id from
 * `rightPanelTabRegistry` — kept as `string` rather than widening the union
 * every time a plugin adds one. */
export type RightPanelTab = "outline" | "backlinks" | "graph" | "history" | (string & {});
/** The 6 built-in views, plus any plugin-registered id from
 * `sidebarViewRegistry`. */
export type SidebarView = "files" | "search" | "tags" | "tasks" | "calendar" | "sync" | (string & {});
export type SearchPanelMode = "search" | "replace";
export type TemplateDialogMode = "insert" | "create" | null;

interface UiState {
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;
  rightPanelCollapsed: boolean;
  toggleRightPanelCollapsed: () => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;

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
  searchOptionsOpen: boolean;
  setSearchOptionsOpen: (open: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  quickSwitcherOpen: boolean;
  setQuickSwitcherOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  templateDialog: TemplateDialogMode;
  setTemplateDialog: (mode: TemplateDialogMode) => void;

  quickNoteOpen: boolean;
  setQuickNoteOpen: (open: boolean) => void;

  /** Already-resolved image URL (asset:// for local, http(s) for external)
   * shown full-screen, or null when the lightbox is closed. */
  lightboxImageSrc: string | null;
  setLightboxImageSrc: (src: string | null) => void;

  unusedAttachmentsOpen: boolean;
  setUnusedAttachmentsOpen: (open: boolean) => void;

  /** Opens the search panel pre-filled with a query — used by "click a tag
   * to search for it" both in the tags panel and inline in the editor. */
  openSearchWithQuery: (query: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  rightPanelTab: "outline",
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  rightPanelCollapsed: false,
  toggleRightPanelCollapsed: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),

  sidebarView: "files",
  setSidebarView: (view) => set({
    sidebarView: view,
    ...(view === "search" ? {} : { searchOptionsOpen: false }),
  }),
  sidebarCollapsed: false,
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchPanelMode: "search",
  setSearchPanelMode: (mode) => set({ searchPanelMode: mode }),
  searchOptionsOpen: false,
  setSearchOptionsOpen: (open) => set({ searchOptionsOpen: open }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  quickSwitcherOpen: false,
  setQuickSwitcherOpen: (open) => set({ quickSwitcherOpen: open }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  templateDialog: null,
  setTemplateDialog: (mode) => set({ templateDialog: mode }),

  quickNoteOpen: false,
  setQuickNoteOpen: (open) => set({ quickNoteOpen: open }),

  lightboxImageSrc: null,
  setLightboxImageSrc: (src) => set({ lightboxImageSrc: src }),

  unusedAttachmentsOpen: false,
  setUnusedAttachmentsOpen: (open) => set({ unusedAttachmentsOpen: open }),

  openSearchWithQuery: (query) =>
    set({
      sidebarView: "search",
      sidebarCollapsed: false,
      searchPanelMode: "search",
      searchQuery: query,
      searchOptionsOpen: false,
    }),
}));

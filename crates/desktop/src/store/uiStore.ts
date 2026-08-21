import { create } from "zustand";

export type RightPanelTab = "outline" | "backlinks" | "graph";

interface UiState {
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;
}

export const useUiStore = create<UiState>((set) => ({
  rightPanelTab: "outline",
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
}));
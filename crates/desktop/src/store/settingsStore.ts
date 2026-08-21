import { create } from "zustand";
import { persist } from "zustand/middleware";
import { detectLanguage, type SupportedLanguage } from "../i18n";

export type ThemePreference = "light" | "dark" | "system";

export interface GraphColors {
  /** Empty string means "use the theme default". */
  background: string;
  link: string;
  node: string;
  accent: string;
}

export interface AppSettings {
  theme: ThemePreference;
  language: SupportedLanguage;
  editor: {
    fontSize: number;
  };
  graph: {
    showLabels: boolean;
    nodeSize: number;
    linkDistance: number;
    repulsion: number;
    localDepth: number;
    colors: GraphColors;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  language: detectLanguage(),
  editor: {
    fontSize: 16,
  },
  graph: {
    showLabels: true,
    nodeSize: 6,
    linkDistance: 90,
    repulsion: 700,
    localDepth: 2,
    colors: {
      background: "",
      link: "",
      node: "",
      accent: "",
    },
  },
};

interface SettingsState {
  settings: AppSettings;
  setSettings: (partial: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),
    }),
    {
      name: "nodus:settings",
      version: 1,
      partialize: (s) => ({ settings: s.settings }),
    },
  ),
);

export function useSetting<T>(selector: (settings: AppSettings) => T): T {
  return useSettingsStore((s) => selector(s.settings));
}
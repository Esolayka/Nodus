import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "system" follows whatever theme the user's own Telegram client is in
 * (see telegram.ts's applyMiniAppTheme) — "light"/"dark" are an explicit
 * override that ignores Telegram's theme entirely. */
export type MiniAppThemePreference = "system" | "light" | "dark";

interface ThemeState {
  preference: MiniAppThemePreference;
  setPreference: (preference: MiniAppThemePreference) => void;
}

export const useMiniAppThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "system",
      setPreference: (preference) => set({ preference }),
    }),
    { name: "nodus-miniapp:theme" },
  ),
);

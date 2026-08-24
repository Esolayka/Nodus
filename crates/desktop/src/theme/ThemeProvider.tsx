import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSettingsStore, type ThemePreference } from "../store/settingsStore";
import { CUSTOM_THEME_COLOR_FIELDS } from "./customThemes";

type EffectiveTheme = "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSettingsStore((s) => s.settings.theme);
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() =>
    resolveEffectiveTheme("system"),
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(media.matches ? "dark" : "light");
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const customTheme = useMemo(
    () =>
      appearance.customThemes.find(
        (theme) => theme.id === appearance.activeCustomThemeId,
      ) ?? null,
    [appearance.activeCustomThemeId, appearance.customThemes],
  );

  const effectiveTheme: EffectiveTheme = customTheme?.base ??
    (preference === "system" ? systemTheme : preference);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = effectiveTheme;

    for (const field of CUSTOM_THEME_COLOR_FIELDS) {
      root.style.removeProperty(field.cssVariable);
    }
    root.style.removeProperty("--font-ui");
    root.style.removeProperty("--font-text");
    root.style.removeProperty("--font-mono");

    if (customTheme) {
      root.dataset.customTheme = customTheme.id;
      for (const field of CUSTOM_THEME_COLOR_FIELDS) {
        root.style.setProperty(field.cssVariable, customTheme.colors[field.key]);
      }
      root.style.setProperty("--accent-hover", customTheme.colors.accent);
    } else {
      delete root.dataset.customTheme;
      root.style.removeProperty("--accent-hover");
    }

    const interfaceFont = appearance.interfaceFont.trim();
    if (interfaceFont) {
      root.style.setProperty("--font-ui", interfaceFont);
      root.style.setProperty("--font-text", interfaceFont);
    }
    const monospaceFont = appearance.monospaceFont.trim();
    if (monospaceFont) root.style.setProperty("--font-mono", monospaceFont);
  }, [appearance.interfaceFont, appearance.monospaceFont, customTheme, effectiveTheme]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      const currentAppearance = useSettingsStore.getState().settings.appearance;
      setSettings({
        theme: next,
        appearance: { ...currentAppearance, activeCustomThemeId: null },
      });
    },
    [setSettings],
  );

  const value = useMemo(
    () => ({ preference, effectiveTheme, setPreference }),
    [preference, effectiveTheme, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

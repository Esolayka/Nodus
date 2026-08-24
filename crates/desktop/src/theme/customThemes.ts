export type CustomThemeBase = "light" | "dark";

export const CUSTOM_THEME_COLOR_FIELDS = [
  { key: "background", cssVariable: "--bg-primary" },
  { key: "secondary", cssVariable: "--bg-secondary" },
  { key: "surface", cssVariable: "--bg-tertiary" },
  { key: "sidebar", cssVariable: "--bg-sidebar" },
  { key: "titlebar", cssVariable: "--bg-titlebar" },
  { key: "text", cssVariable: "--text-normal" },
  { key: "mutedText", cssVariable: "--text-muted" },
  { key: "faintText", cssVariable: "--text-faint" },
  { key: "accent", cssVariable: "--accent" },
  { key: "danger", cssVariable: "--danger" },
] as const;

export type CustomThemeColorKey =
  (typeof CUSTOM_THEME_COLOR_FIELDS)[number]["key"];

export type CustomThemeColors = Record<CustomThemeColorKey, string>;

export interface CustomTheme {
  id: string;
  name: string;
  base: CustomThemeBase;
  colors: CustomThemeColors;
}

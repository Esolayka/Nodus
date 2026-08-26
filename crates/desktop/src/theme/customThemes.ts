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

/** Extracts `--custom-property: value;` declarations from raw CSS text —
 * this is deliberately not a full CSS parser (no selector awareness), since
 * an imported theme file is expected to be just a `:root { ... }` block of
 * variables from the table in docs/themes.md. Whatever selector(s) it
 * actually uses don't matter; every declaration in the file is collected. */
export function parseCssCustomProperties(css: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  for (const match of css.matchAll(pattern)) {
    result[match[1].trim()] = match[2].trim();
  }
  return result;
}

function relativeLuminance(color: string): number | null {
  const hex = color.trim().replace("#", "");
  const full = hex.length === 3
    ? hex.split("").map((c) => c + c).join("")
    : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Builds a complete color set from whatever variables an imported file
 * actually defines, falling back to `fallback` (normally the currently
 * active theme's own colors) for the rest — a theme file that only
 * overrides a couple of colors still produces a usable result instead of
 * leaving the others blank. `base` is inferred from the background's
 * lightness rather than asked of the file, since nothing in the variable
 * table carries that information on its own. */
export function themeColorsFromCssVariables(
  vars: Record<string, string>,
  fallback: CustomThemeColors,
): { colors: CustomThemeColors; base: CustomThemeBase; matched: number } {
  const colors = { ...fallback };
  let matched = 0;
  for (const field of CUSTOM_THEME_COLOR_FIELDS) {
    const value = vars[field.cssVariable];
    if (value) {
      colors[field.key] = value;
      matched += 1;
    }
  }
  const luminance = relativeLuminance(colors.background);
  const base: CustomThemeBase = luminance !== null && luminance > 0.5 ? "light" : "dark";
  return { colors, base, matched };
}

import { describe, expect, it } from "vitest";
import {
  parseCssCustomProperties,
  themeColorsFromCssVariables,
  type CustomThemeColors,
} from "./customThemes";

const FALLBACK: CustomThemeColors = {
  background: "#111111",
  secondary: "#222222",
  surface: "#333333",
  sidebar: "#444444",
  titlebar: "#555555",
  text: "#666666",
  mutedText: "#777777",
  faintText: "#888888",
  accent: "#999999",
  danger: "#aaaaaa",
};

describe("parseCssCustomProperties", () => {
  it("extracts declarations regardless of selector", () => {
    const css = `
      :root {
        --bg-primary: #f4ecd8;
        --accent: #b5652d;
      }
    `;
    expect(parseCssCustomProperties(css)).toEqual({
      "--bg-primary": "#f4ecd8",
      "--accent": "#b5652d",
    });
  });

  it("ignores non-variable declarations", () => {
    const css = `:root { color: red; --text-normal: #4a3c28; }`;
    expect(parseCssCustomProperties(css)).toEqual({
      "--text-normal": "#4a3c28",
    });
  });

  it("returns an empty object for unrelated CSS", () => {
    expect(parseCssCustomProperties("body { margin: 0; }")).toEqual({});
  });
});

describe("themeColorsFromCssVariables", () => {
  it("fills matched fields and keeps the fallback for the rest", () => {
    const vars = { "--bg-primary": "#f4ecd8", "--accent": "#b5652d" };
    const { colors, matched } = themeColorsFromCssVariables(vars, FALLBACK);
    expect(matched).toBe(2);
    expect(colors.background).toBe("#f4ecd8");
    expect(colors.accent).toBe("#b5652d");
    expect(colors.text).toBe(FALLBACK.text);
  });

  it("infers a light base from a light background", () => {
    const { base } = themeColorsFromCssVariables(
      { "--bg-primary": "#f4ecd8" },
      FALLBACK,
    );
    expect(base).toBe("light");
  });

  it("infers a dark base from a dark background", () => {
    const { base } = themeColorsFromCssVariables(
      { "--bg-primary": "#1e1e1e" },
      FALLBACK,
    );
    expect(base).toBe("dark");
  });

  it("reports zero matches for a file with no known variables", () => {
    const { matched } = themeColorsFromCssVariables(
      { "--some-unrelated-var": "1px" },
      FALLBACK,
    );
    expect(matched).toBe(0);
  });
});

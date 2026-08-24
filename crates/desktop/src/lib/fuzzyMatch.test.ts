import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzyMatch";

describe("fuzzyMatch", () => {
  it("matches a case-insensitive subsequence", () => {
    expect(fuzzyMatch("прг", "Программирование")?.indices).toEqual([0, 1, 3]);
  });

  it("prefers contiguous matches", () => {
    const contiguous = fuzzyMatch("note", "note archive");
    const scattered = fuzzyMatch("note", "nxxoxxtxxe");
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it("returns null when the full query cannot be matched", () => {
    expect(fuzzyMatch("graph", "canvas")).toBeNull();
  });
});

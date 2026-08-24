import { describe, expect, it } from "vitest";
import { formatDate, isSameDay, parseDateTolerant, parseDateWithFormat } from "./dateFormat";

describe("dateFormat", () => {
  it("formats every supported token", () => {
    const date = new Date(2026, 7, 4, 9, 5, 2);
    expect(formatDate(date, "YYYY-MM-DD HH:mm:ss")).toBe("2026-08-04 09:05:02");
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateWithFormat("2026-02-31", "YYYY-MM-DD")).toBeNull();
  });

  it("finds dates created with a previous common format", () => {
    const parsed = parseDateTolerant("24.08.2026", "YYYY-MM-DD");
    expect(parsed).not.toBeNull();
    expect(isSameDay(parsed!, new Date(2026, 7, 24))).toBe(true);
  });
});

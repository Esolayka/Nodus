import { describe, expect, it } from "vitest";
import { displayName } from "./displayName";

describe("displayName", () => {
  it("removes supported note extensions", () => {
    expect(displayName("Projects/Nodus.md")).toBe("Nodus");
    expect(displayName("notes/README.MARKDOWN")).toBe("README");
    expect(displayName("draft.txt")).toBe("draft");
  });

  it("preserves unsupported and hidden-file extensions", () => {
    expect(displayName("assets/logo.png")).toBe("logo.png");
    expect(displayName(".md")).toBe(".md");
  });
});

/** The centralized hotkey table: command id -> key combo. Defaults live
 * here; user overrides live in `settingsStore`'s `hotkeys` slice and are
 * merged on top. Key combos are normalized strings like `"mod+shift+f"`
 * (`"mod"` covers both Ctrl and Cmd, so one binding works cross-platform). */

export const DEFAULT_BINDINGS: Record<string, string> = {
  "app.commandPalette": "mod+p",
  "app.quickSwitcher": "mod+o",
  "app.newNote": "mod+n",
  "app.save": "mod+s",
  "app.toggleEditorMode": "mod+e",
  "app.findInNote": "mod+f",
  "app.findInVault": "mod+shift+f",
  "app.closeTab": "mod+w",
  "app.newTab": "mod+t",
  "app.openSettings": "mod+,",
  "app.toggleSidebar": "mod+b",
  "app.openGraph": "mod+g",
};

const MODIFIER_KEYS = new Set(["control", "meta", "shift", "alt"]);

/** Normalizes a live `KeyboardEvent` into the same string format used by
 * `DEFAULT_BINDINGS` / stored overrides. */
export function normalizeKeyEvent(e: KeyboardEvent): string | null {
  let key = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null; // a bare modifier press isn't a bindable combo
  if (key === " ") key = "space";
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(key);
  return parts.join("+");
}

/** Merges user overrides on top of the defaults. */
export function effectiveBindings(overrides: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_BINDINGS, ...overrides };
}

export function keysForCommand(commandId: string, overrides: Record<string, string>): string | undefined {
  return overrides[commandId] ?? DEFAULT_BINDINGS[commandId];
}

/** A human-readable label for a normalized combo, e.g. `"mod+shift+f"` ->
 * `"Ctrl+Shift+F"` (or `"Cmd+Shift+F"` on macOS). */
export function labelForKeys(keys: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  return keys
    .split("+")
    .map((part) => {
      if (part === "mod") return isMac ? "Cmd" : "Ctrl";
      if (part === "shift") return "Shift";
      if (part === "alt") return isMac ? "Option" : "Alt";
      if (part === ",") return ",";
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}

/** Which command (if any, other than `excludingCommandId`) already owns
 * `keys` in the effective (merged) binding table — for conflict detection
 * when the user tries to assign an already-used combo. */
export function findConflict(
  keys: string,
  overrides: Record<string, string>,
  excludingCommandId?: string,
): string | null {
  const merged = effectiveBindings(overrides);
  for (const [id, boundKeys] of Object.entries(merged)) {
    if (boundKeys && boundKeys === keys && id !== excludingCommandId) return id;
  }
  return null;
}

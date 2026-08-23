import type { NodusPlugin } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** e.g. "2026-08-23 143512" — sortable, and collision-proof enough that the
 * existing " 1"/" 2" de-dupe suffix (from `uniqueName` in vaultStore) only
 * ever kicks in for two notes created within the same second. */
function timestampName(date: Date): string {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${mo}-${d} ${h}${mi}${s}`;
}

export const uniqueNoteNamesPlugin: NodusPlugin = {
  id: "core.uniqueNoteNames",
  nameKey: "plugins.uniqueNoteNames.name",
  descriptionKey: "plugins.uniqueNoteNames.description",
  tier: "isolated",
  defaultEnabled: false,
  onEnable(ctx) {
    return ctx.registerNoteNameProvider(() => timestampName(new Date()));
  },
};

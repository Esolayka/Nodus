import type { PluginContext } from "./context";

/** "isolated": reads/writes vault data, registers commands and UI panels —
 * everything the 12 non-editor tools need. "full": additionally reaches
 * into the live CodeMirror instance (new decorations, keymaps, autocomplete
 * sources) — reserved for slash commands and slide mode, the only two
 * Level 2/3 tools that actually need it. The distinction is a code-review
 * convention right now, not a real sandbox: there's no iframe/wasm
 * isolation, since there are no third-party plugins yet to isolate from. */
export type PluginTier = "isolated" | "full";

export interface NodusPlugin {
  id: string;
  nameKey: string;
  descriptionKey: string;
  tier: PluginTier;
  defaultEnabled: boolean;
  /** Called when the plugin transitions from disabled to enabled (including
   * once at startup, for anything enabled by default). Whatever it returns
   * is called on the reverse transition — register through this, not a
   * module-level side effect, so disabling actually undoes everything. */
  onEnable: (ctx: PluginContext) => (() => void) | void;
}

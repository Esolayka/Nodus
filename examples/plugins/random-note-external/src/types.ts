// Hand-copied from Nodus's `src/plugins/types.ts` / `src/plugins/context.ts`
// — deliberately NOT imported from the app's source. A real third-party
// plugin has no access to that source at all; it only has whatever the host
// documents as the contract (here, this file stands in for that published
// `.d.ts`). If Nodus's actual `PluginContext` shape ever drifts from this
// copy, this plugin simply breaks at runtime — the same risk any real
// external plugin takes.

export type PluginTier = "isolated" | "full";

export interface Command {
  id: string;
  title: string;
  hotkeyLabel?: string;
  run: () => void | Promise<void>;
}

export interface PluginContext {
  registerCommand: (command: Command) => () => void;
  vault: {
    listNotes(): { path: string; title: string }[];
  };
  workspace: {
    openNote(path: string): Promise<void>;
  };
}

export interface NodusPlugin {
  id: string;
  nameKey: string;
  descriptionKey: string;
  tier: PluginTier;
  defaultEnabled: boolean;
  onEnable: (ctx: PluginContext) => (() => void) | void;
}

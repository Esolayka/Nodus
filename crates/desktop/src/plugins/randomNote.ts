import i18next from "../i18n";
import type { PluginContext } from "./context";
import type { NodusPlugin } from "./types";

async function openRandomNote(ctx: PluginContext) {
  const notes = ctx.vault.listNotes();
  if (notes.length === 0) return;
  const { path } = notes[Math.floor(Math.random() * notes.length)];
  await ctx.workspace.openNote(path);
}

export const randomNotePlugin: NodusPlugin = {
  id: "core.randomNote",
  nameKey: "plugins.randomNote.name",
  descriptionKey: "plugins.randomNote.description",
  tier: "isolated",
  defaultEnabled: true,
  onEnable(ctx) {
    return ctx.registerCommand({
      id: "randomNote.open",
      title: i18next.t("plugins.randomNote.command"),
      run: () => void openRandomNote(ctx),
    });
  },
};

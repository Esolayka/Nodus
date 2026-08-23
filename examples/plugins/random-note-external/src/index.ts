import type { NodusPlugin, PluginContext } from "./types";

async function openRandomNote(ctx: PluginContext): Promise<void> {
  const notes = ctx.vault.listNotes();
  if (notes.length === 0) return;
  const { path } = notes[Math.floor(Math.random() * notes.length)];
  await ctx.workspace.openNote(path);
}

const plugin: NodusPlugin = {
  id: "external.randomNoteDemo",
  nameKey: "external.randomNoteDemo.name",
  descriptionKey: "external.randomNoteDemo.description",
  tier: "isolated",
  defaultEnabled: true,
  onEnable(ctx) {
    return ctx.registerCommand({
      id: "external.randomNoteDemo.open",
      title: "Open random note (external plugin)",
      run: () => void openRandomNote(ctx),
    });
  },
};

export default plugin;

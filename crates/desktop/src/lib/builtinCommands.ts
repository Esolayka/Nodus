import i18next from "../i18n";
import { getEditor } from "../editor/editorRegistry";
import { openInFileSearch } from "../editor/inFileSearch";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { DEFAULT_BINDINGS, labelForKeys } from "./hotkeyRegistry";
import { registerCommand } from "./commandRegistry";

function activePane() {
  const state = useWorkspaceStore.getState();
  return state.panes.find((p) => p.id === state.activePaneId);
}

async function createAndOpenNote() {
  const path = await useVaultStore.getState().createFile("", i18next.t("fileTree.untitled"));
  await useWorkspaceStore.getState().openNote(path);
}

/** Registers every command with a stable app.* id shipped with the app
 * itself — through the exact same `registerCommand` a plugin would use,
 * there's no separate "built-in" registration path. Call once at startup;
 * returns a combined unregister function (not that built-ins are ever
 * expected to be unregistered, but it keeps the shape consistent). */
export function registerBuiltinCommands(): () => void {
  const hotkeyLabel = (id: string) => labelForKeys(DEFAULT_BINDINGS[id]);
  const unregisterFns: (() => void)[] = [];
  const reg = (id: string, title: string, run: () => void | Promise<void>) => {
    unregisterFns.push(registerCommand({ id, title, hotkeyLabel: hotkeyLabel(id), run }));
  };

  reg("app.newNote", i18next.t("commands.newNote"), () => void createAndOpenNote());

  // No distinct "blank tab" concept exists yet (every tab shows a note) —
  // until one does, "new tab" and "new note" both land on the same action.
  reg("app.newTab", i18next.t("commands.newTab"), () => void createAndOpenNote());

  reg("app.save", i18next.t("commands.save"), () => {
    const pane = activePane();
    if (pane?.activePath) void useWorkspaceStore.getState().flush(pane.activePath);
  });

  reg("app.toggleEditorMode", i18next.t("commands.toggleEditorMode"), () => {
    const pane = activePane();
    if (pane?.activePath) useWorkspaceStore.getState().toggleLiveSource(pane.activePath);
  });

  reg("app.closeTab", i18next.t("commands.closeTab"), () => {
    const pane = activePane();
    if (pane?.activePath) useWorkspaceStore.getState().closeTab(pane.id, pane.activePath);
  });

  reg("app.openSettings", i18next.t("commands.openSettings"), () => {
    useUiStore.getState().setSettingsOpen(true);
  });

  reg("app.toggleSidebar", i18next.t("commands.toggleSidebar"), () => {
    useUiStore.getState().toggleSidebarCollapsed();
  });

  reg("app.findInVault", i18next.t("commands.findInVault"), () => {
    useUiStore.getState().openSearchWithQuery(useUiStore.getState().searchQuery);
  });

  reg("app.findInNote", i18next.t("commands.findInNote"), () => {
    const pane = activePane();
    if (!pane?.activePath) return;
    const view = getEditor(pane.activePath);
    if (view) openInFileSearch(view);
  });

  reg("app.commandPalette", i18next.t("commands.commandPalette"), () => {
    useUiStore.getState().setCommandPaletteOpen(true);
  });

  reg("app.quickSwitcher", i18next.t("commands.quickSwitcher"), () => {
    useUiStore.getState().setQuickSwitcherOpen(true);
  });

  return () => {
    for (const fn of unregisterFns) fn();
  };
}

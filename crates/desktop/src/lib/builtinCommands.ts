import i18next from "../i18n";
import { getEditor } from "../editor/editorRegistry";
import { openInFileSearch } from "../editor/inFileSearch";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { pickAndAttachFiles } from "./attachments";
import { openAdjacentDailyNote, openTodayNote } from "./dailyNotes";
import { DEFAULT_BINDINGS, labelForKeys } from "./hotkeyRegistry";
import { defaultNoteName } from "./noteNaming";
import { registerCommand } from "./commandRegistry";

function activePane() {
  const state = useWorkspaceStore.getState();
  return state.panes.find((p) => p.id === state.activePaneId);
}

async function createAndOpenNote() {
  const path = await useVaultStore
    .getState()
    .createFile("", defaultNoteName(i18next.t("fileTree.untitled")));
  await useWorkspaceStore.getState().openNote(path);
}

async function createAndOpenCanvas() {
  const path = await useVaultStore.getState().createFileWithExtension("", i18next.t("canvas.untitled"), ".canvas");
  await useWorkspaceStore.getState().openNote(path);
}

/** Registers every command with a stable app.* id shipped with the app
 * itself — through the exact same `registerCommand` a plugin would use,
 * there's no separate "built-in" registration path. Call once at startup;
 * returns a combined unregister function (not that built-ins are ever
 * expected to be unregistered, but it keeps the shape consistent). */
export function registerBuiltinCommands(): () => void {
  const hotkeyLabel = (id: string) => (DEFAULT_BINDINGS[id] ? labelForKeys(DEFAULT_BINDINGS[id]) : undefined);
  const unregisterFns: (() => void)[] = [];
  const reg = (id: string, title: string, run: () => void | Promise<void>) => {
    unregisterFns.push(registerCommand({ id, title, hotkeyLabel: hotkeyLabel(id), run }));
  };

  reg("app.newNote", i18next.t("commands.newNote"), () => void createAndOpenNote());

  // Unlike Ctrl+N, this creates nothing on disk — just a blank tab
  // showing the same empty-pane placeholder, until the user actually
  // picks "create new file" (or a file) from it.
  reg("app.newTab", i18next.t("commands.newTab"), () => useWorkspaceStore.getState().openEmptyTab());

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
    if (!pane) return;
    if (pane.view === "graph") {
      useWorkspaceStore.getState().closeView(pane.id);
    } else if (pane.activePath) {
      useWorkspaceStore.getState().closeTab(pane.id, pane.activePath);
    }
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

  reg("dailyNotes.openToday", i18next.t("commands.dailyNotesOpenToday"), () => void openTodayNote());
  reg("dailyNotes.openPrevious", i18next.t("commands.dailyNotesOpenPrevious"), () => void openAdjacentDailyNote(-1));
  reg("dailyNotes.openNext", i18next.t("commands.dailyNotesOpenNext"), () => void openAdjacentDailyNote(1));
  reg("dailyNotes.gotoDate", i18next.t("commands.dailyNotesGotoDate"), () => {
    useUiStore.getState().setSidebarView("calendar");
    if (useUiStore.getState().sidebarCollapsed) useUiStore.getState().toggleSidebarCollapsed();
  });
  reg("dailyNotes.quickNote", i18next.t("commands.dailyNotesQuickNote"), () => {
    useUiStore.getState().setQuickNoteOpen(true);
  });

  reg("templates.insertAtCursor", i18next.t("commands.templatesInsert"), () => {
    useUiStore.getState().setTemplateDialog("insert");
  });
  reg("templates.createNote", i18next.t("commands.templatesCreateNote"), () => {
    useUiStore.getState().setTemplateDialog("create");
  });

  reg("attachments.attachFile", i18next.t("commands.attachFile"), () => {
    const pane = activePane();
    if (!pane?.activePath) return;
    const view = getEditor(pane.activePath);
    if (!view) return;
    void pickAndAttachFiles(pane.activePath).then((snippets) => {
      if (!snippets) return;
      const { from, to } = view.state.selection.main;
      const insert = snippets.join("\n");
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    });
  });

  reg("attachments.findUnused", i18next.t("commands.findUnusedAttachments"), () => {
    useUiStore.getState().setUnusedAttachmentsOpen(true);
  });

  reg("canvas.new", i18next.t("commands.newCanvas"), () => void createAndOpenCanvas());

  return () => {
    for (const fn of unregisterFns) fn();
  };
}

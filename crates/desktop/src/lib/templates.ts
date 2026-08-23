import { getEditor } from "../editor/editorRegistry";
import { insertExpandedTemplate } from "../editor/templateInsert";
import * as api from "../api/vault";
import { useSettingsStore } from "../store/settingsStore";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { collectInputPrompts, expandTemplate } from "./templateEngine";

const CURSOR_RE = /\{\{\s*cursor\s*\}\}/g;

export interface TemplateFile {
  path: string;
  title: string;
}

/** Every note under the configured templates folder — templates are just
 * ordinary notes there, nothing marks them as special beyond location. */
export function listTemplates(): TemplateFile[] {
  const folder = useSettingsStore.getState().settings.templates.folder;
  const prefix = folder ? `${folder}/` : "";
  return useVaultStore
    .getState()
    .noteIndex.notes.filter((n) => (folder ? n.path.startsWith(prefix) : true));
}

function activeEditorPath(): string | null {
  const state = useWorkspaceStore.getState();
  const pane = state.panes.find((p) => p.id === state.activePaneId);
  return pane?.activePath ?? null;
}

/** Strips every `{{cursor}}` marker, returning the offset the *first* one
 * was at (in the resulting stripped text) so a freshly created note can
 * still place the cursor there once opened. */
function stripCursorMarkers(text: string): { content: string; firstCursorOffset: number | null } {
  CURSOR_RE.lastIndex = 0;
  const match = CURSOR_RE.exec(text);
  const content = text.replace(CURSOR_RE, "");
  return { content, firstCursorOffset: match ? match.index : null };
}

/** 1-indexed line + in-line char offset for a raw character offset — used
 * to hand a freshly-computed cursor position to `jumpToLine`, which already
 * knows how to wait for a just-opened note's editor to finish mounting. */
function offsetToLineCol(content: string, offset: number): { line: number; col: number } {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, col: lines[lines.length - 1].length };
}

/** Inserts a template at the active editor's cursor, prompting for any
 * `{{input:...}}` answers first. A no-op if nothing is focused to insert
 * into. */
export async function insertTemplateAtCursor(
  templatePath: string,
  promptForInputs: (prompts: string[]) => Promise<string[] | null>,
): Promise<void> {
  const path = activeEditorPath();
  if (!path) return;
  const view = getEditor(path);
  if (!view) return;

  const raw = await api.readNote(templatePath);
  const prompts = collectInputPrompts(raw);
  const answers = prompts.length > 0 ? await promptForInputs(prompts) : [];
  if (answers == null) return; // user cancelled the input dialog

  const title = path.slice(path.lastIndexOf("/") + 1, -3);
  const selection = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const expanded = expandTemplate(raw, { title, selection }, answers);
  insertExpandedTemplate(view, expanded);
}

/** Creates a new note named `baseName` seeded from `templatePath`'s
 * expanded content, opens it, and — if the template had a `{{cursor}}`
 * marker — places the cursor there. Returns the created note's path. */
export async function createNoteFromTemplate(
  templatePath: string,
  baseName: string,
  promptForInputs: (prompts: string[]) => Promise<string[] | null>,
): Promise<string | null> {
  const raw = await api.readNote(templatePath);
  const prompts = collectInputPrompts(raw);
  const answers = prompts.length > 0 ? await promptForInputs(prompts) : [];
  if (answers == null) return null;

  const path = await useVaultStore.getState().createFile("", baseName);
  const title = path.slice(path.lastIndexOf("/") + 1, -3);
  const expanded = expandTemplate(raw, { title, selection: "" }, answers);
  const { content, firstCursorOffset } = stripCursorMarkers(expanded);
  await api.writeNote(path, content);

  if (firstCursorOffset != null) {
    const { line, col } = offsetToLineCol(content, firstCursorOffset);
    await useWorkspaceStore.getState().jumpToLine(path, line, [col, col]);
  } else {
    await useWorkspaceStore.getState().openNote(path);
  }
  return path;
}

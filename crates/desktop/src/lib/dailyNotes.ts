import * as api from "../api/vault";
import { useSettingsStore } from "../store/settingsStore";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { formatDate, parseDateTolerant } from "./dateFormat";
import { expandTemplate } from "./templateEngine";

function settings() {
  return useSettingsStore.getState().settings.dailyNotes;
}

export function dailyNotePath(date: Date): string {
  const { folder, filenameFormat } = settings();
  const filename = `${formatDate(date, filenameFormat)}.md`;
  return folder ? `${folder}/${filename}` : filename;
}

/** If `path` is inside the daily notes folder and its basename parses as a
 * date (current format or a tolerant fallback), returns that date —
 * used so "previous"/"next" step from whatever daily note is open, not
 * always from today. */
export function dateOfDailyNote(path: string): Date | null {
  const { folder, filenameFormat } = settings();
  const prefix = folder ? `${folder}/` : "";
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return null;
  const rest = path.slice(prefix.length, -3);
  if (rest.includes("/")) return null; // nested folders aren't daily notes
  return parseDateTolerant(rest, filenameFormat);
}

/** Creates the note for `date` (missing parent folders included) if it
 * doesn't exist yet, seeding it from the configured template. Never throws
 * on "already exists" — that just means there's nothing to do. */
async function ensureDailyNote(date: Date): Promise<string> {
  const path = dailyNotePath(date);
  const alreadyExists = useVaultStore.getState().noteIndex.allPaths.has(path);
  if (alreadyExists) return path;

  try {
    await api.createFile(path);
  } catch {
    // Already exists on disk even though our tree cache didn't know it yet.
    return path;
  }

  const { templatePath } = settings();
  if (templatePath) {
    const title = path.slice(path.lastIndexOf("/") + 1, -3);
    const raw = await api.readNote(templatePath).catch(() => "");
    if (raw) {
      const expanded = expandTemplate(raw, { title, selection: "" }, []).replace(/\{\{\s*cursor\s*\}\}/g, "");
      await api.writeNote(path, expanded);
    }
  }
  await useVaultStore.getState().refreshTree();
  return path;
}

export async function openDailyNote(date: Date): Promise<void> {
  const path = await ensureDailyNote(date);
  await useWorkspaceStore.getState().openNote(path);
}

function activeDailyNoteDate(): Date {
  const state = useWorkspaceStore.getState();
  const pane = state.panes.find((p) => p.id === state.activePaneId);
  const fromActive = pane?.activePath ? dateOfDailyNote(pane.activePath) : null;
  return fromActive ?? new Date();
}

export async function openTodayNote(): Promise<void> {
  await openDailyNote(new Date());
}

export async function openAdjacentDailyNote(deltaDays: number): Promise<void> {
  const base = activeDailyNoteDate();
  const next = new Date(base);
  next.setDate(next.getDate() + deltaDays);
  await openDailyNote(next);
}

/** Appends one line to today's note without opening it as a tab — creating
 * the note first (template included) if this is the day's first entry.
 * Any tab already open on that path is kept in sync the same way an
 * external edit would be. */
export async function appendToDailyNote(text: string): Promise<string> {
  const path = await ensureDailyNote(new Date());
  const current = await api.readNote(path);
  const needsNewline = current.length > 0 && !current.endsWith("\n");
  const updated = `${current}${needsNewline ? "\n" : ""}${text}\n`;
  await api.writeNote(path, updated);
  await useWorkspaceStore.getState().handleExternalChange({ kind: "modified", path });
  return path;
}

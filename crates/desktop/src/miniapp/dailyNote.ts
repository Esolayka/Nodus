import { formatDate, DEFAULT_DAILY_NOTE_FORMAT } from "../lib/dateFormat";
import { readNote, saveNote } from "./sync";

// The desktop's actual daily-notes folder/format live in its own settings,
// which local mode doesn't yet forward to the Mini App (a real gap, not a
// design choice) — this uses the same defaults a fresh vault starts with
// ("Daily Notes/YYYY-MM-DD.md") until that settings bridge exists.
const DAILY_NOTES_FOLDER = "Daily Notes";

export function todayNotePath(): string {
  return `${DAILY_NOTES_FOLDER}/${formatDate(new Date(), DEFAULT_DAILY_NOTE_FORMAT)}.md`;
}

export async function appendLineToToday(line: string): Promise<void> {
  const path = todayNotePath();
  let content: string;
  let baseHash: string | null;
  try {
    const existing = await readNote(path);
    content = existing.content;
    baseHash = existing.hash;
  } catch {
    content = "";
    baseHash = null;
  }
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const updated = `${content}${separator}${line}\n`;
  const outcome = await saveNote(path, updated, baseHash);
  if (outcome.status === "conflict") {
    // The append itself still landed (as the kept sibling copy) — nothing
    // is lost, just surfaced to the caller so it can tell the user.
    throw new Error("Today's note changed elsewhere — your line was saved separately so nothing was lost.");
  }
}

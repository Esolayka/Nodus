import { useState } from "react";
import { useTranslation } from "react-i18next";
import { saveNote } from "../sync";
import { hapticSuccess } from "../telegram";
import { BottomSheet } from "./BottomSheet";

/** Mirrors the desktop app's own `uniqueName` (store/vaultStore.ts): a
 * plain title that collides with an existing root-level note gets " 2",
 * " 3", … appended rather than blocking the user with an error — the
 * desktop file tree, the sidebar "new note" command, and this sheet
 * should all pick names the same way. */
function uniqueNotePath(rawTitle: string, existingNames: Set<string>): string {
  const trimmed = rawTitle.trim().replace(/\.md$/i, "");
  if (!existingNames.has(`${trimmed}.md`)) return `${trimmed}.md`;
  let i = 2;
  while (existingNames.has(`${trimmed} ${i}.md`)) i += 1;
  return `${trimmed} ${i}.md`;
}

export function NewNoteSheet({
  existingNames,
  onClose,
  onCreated,
}: {
  /** Root-level file names only (e.g. "Ideas.md") — a note nested in a
   * folder shares no namespace with one created at the root. */
  existingNames: Set<string>;
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    const path = uniqueNotePath(title, existingNames);
    setSaving(true);
    setError(null);
    try {
      // baseHash: null tells the server this is a brand new note — it
      // fails as a conflict instead of overwriting if something with this
      // exact path was created elsewhere in the meantime (see saveNote).
      // With the name already de-duplicated against what we last saw,
      // that only happens on a genuine race — worth surfacing as an
      // error rather than silently retrying with yet another suffix.
      const outcome = await saveNote(path, "", null);
      if (outcome.status === "conflict") {
        setError(t("miniapp.newNote.collision"));
        return;
      }
      hapticSuccess();
      onCreated(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <h3 className="miniapp-sheet-title">{t("miniapp.newNote.title")}</h3>
      <input
        className="field new-note-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("miniapp.newNote.placeholder")}
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
      />
      {error && <p className="editor-conflict-banner">{error}</p>}
      <button
        type="button"
        className="miniapp-primary-btn"
        disabled={saving || !title.trim()}
        onClick={() => void handleCreate()}
      >
        {saving ? t("miniapp.newNote.creating") : t("miniapp.newNote.create")}
      </button>
    </BottomSheet>
  );
}

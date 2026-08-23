import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { Check, ChevronLeft, Circle } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { buildNoteIndex } from "../../lib/noteIndex";
import { displayName } from "../../lib/displayName";
import { SyncIndicator } from "../components/SyncIndicator";
import { miniAppEditorExtensions } from "../editor/setup";
import { readNote, readTree, saveNote } from "../sync";
import { useBackButton, useMainButton } from "../telegram";

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function EditorScreen({
  path,
  onBack,
  onNavigate,
}: {
  path: string;
  onBack: () => void;
  onNavigate: (path: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const baseHashRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const view = viewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    const outcome = await saveNote(path, content, baseHashRef.current);
    if (outcome.status === "saved") {
      baseHashRef.current = outcome.hash ?? baseHashRef.current;
      setDirty(false);
    } else if (outcome.status === "conflict") {
      setConflictNotice(
        `Someone else changed this note in the meantime. Your edit was kept as "${outcome.conflictSiblingPath}" — nothing was lost.`,
      );
      setDirty(false);
    } else {
      // Queued for later — still counts as "handled," the sync indicator
      // (and the log, on the desktop) carries the rest of the story.
      setDirty(false);
    }
  }

  function scheduleAutosave() {
    setDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(), AUTOSAVE_DEBOUNCE_MS);
  }

  useBackButton(() => {
    void save();
    onBack();
  });

  useMainButton({ text: dirty ? "Save" : "Saved", onClick: () => void save(), visible: true, enabled: dirty });

  useEffect(() => {
    let cancelled = false;

    async function open() {
      setLoading(true);
      setError(null);
      try {
        const [note, tree] = await Promise.all([readNote(path), readTree()]);
        if (cancelled || !hostRef.current) return;
        baseHashRef.current = note.hash;
        const noteIndex = buildNoteIndex(tree);

        const state = EditorState.create({
          doc: note.content,
          extensions: [
            ...miniAppEditorExtensions(path, noteIndex, (_target, resolvedPath) => {
              if (resolvedPath) {
                void save();
                onNavigate(resolvedPath);
              }
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) scheduleAutosave();
            }),
          ],
        });
        viewRef.current?.destroy();
        viewRef.current = new EditorView({ state, parent: hostRef.current });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void open();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Re-opens fully when the note changes; that's the point of a
    // dedicated editor "screen" rather than swapping content in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <div className="editor-screen">
      <SyncIndicator />
      <div className="editor-screen-header">
        <button type="button" className="editor-back-btn" onClick={() => (void save(), onBack())} aria-label="Back to notes">
          <ChevronLeft size={22} />
        </button>
        <span className="editor-screen-title">{displayName(path)}</span>
        <span className={`editor-status-dot${dirty ? " editor-status-dot-dirty" : ""}`} title={dirty ? "Unsaved changes" : "Saved"}>
          {dirty ? <Circle size={9} fill="currentColor" /> : <Check size={17} />}
        </span>
      </div>
      {conflictNotice && (
        <p className="editor-conflict-banner" onClick={() => setConflictNotice(null)}>
          {conflictNotice}
        </p>
      )}
      {error && <p className="miniapp-empty">{error}</p>}
      {loading && !error && <p className="miniapp-empty">Loading…</p>}
      <div className="editor-host" ref={hostRef} style={{ display: loading || error ? "none" : "block" }} />
    </div>
  );
}

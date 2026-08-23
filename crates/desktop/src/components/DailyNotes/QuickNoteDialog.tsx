import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { appendToDailyNote } from "../../lib/dailyNotes";
import "../FileTree/RenameConfirmDialog.css";

/** The single most-used daily-notes action, per spec: type a line, hit
 * Enter, it lands at the end of today's note — no tab opens, no context
 * switch. */
export function QuickNoteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await appendToDailyNote(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="rename-confirm-modal" role="dialog" aria-modal="true">
        <p className="rename-confirm-title">{t("dailyNotes.quickNoteTitle")}</p>
        <input
          ref={inputRef}
          className="field"
          style={{ padding: "8px 10px" }}
          placeholder={t("dailyNotes.quickNotePlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <div className="rename-confirm-actions">
          <button type="button" className="rename-confirm-cancel" onClick={onClose}>
            {t("fileTree.renameConfirmCancel")}
          </button>
          <button type="button" className="rename-confirm-apply" onClick={() => void submit()} disabled={saving}>
            {t("dailyNotes.quickNoteAdd")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

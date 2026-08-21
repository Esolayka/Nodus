import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";

interface TagRenameDialogProps {
  tag: string;
  onClose: () => void;
}

/** Two steps, like note rename: type the new name, then confirm against a
 * preview of how many notes it'll touch — same shape as
 * `RenameConfirmDialog`, just with its own name-input step first. */
export function TagRenameDialog({ tag, onClose }: TagRenameDialogProps) {
  const { t } = useTranslation();
  const [newTag, setNewTag] = useState(tag);
  const [affected, setAffected] = useState<string[] | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function goToConfirm() {
    const trimmed = newTag.trim().replace(/^#/, "");
    if (!trimmed || trimmed === tag) return;
    const paths = await api.previewTagRename(tag);
    setAffected(paths);
  }

  async function confirmRename() {
    const trimmed = newTag.trim().replace(/^#/, "");
    await api.renameTag(tag, trimmed);
    onClose();
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
        {affected == null ? (
          <>
            <p className="rename-confirm-title">{t("tags.renameTitle", { tag })}</p>
            <input
              ref={inputRef}
              className="rename-confirm-list"
              style={{ padding: "8px 10px", fontFamily: "var(--font-mono)" }}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void goToConfirm();
              }}
            />
            <div className="rename-confirm-actions">
              <button type="button" className="rename-confirm-cancel" onClick={onClose}>
                {t("fileTree.renameConfirmCancel")}
              </button>
              <button type="button" className="rename-confirm-apply" onClick={() => void goToConfirm()}>
                {t("fileTree.renameConfirmApply")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="rename-confirm-title">
              {t("tags.renameConfirmTitle", { count: affected.length })}
            </p>
            <ul className="rename-confirm-list">
              {affected.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
            <div className="rename-confirm-actions">
              <button type="button" className="rename-confirm-cancel" onClick={onClose}>
                {t("fileTree.renameConfirmCancel")}
              </button>
              <button type="button" className="rename-confirm-apply" onClick={() => void confirmRename()}>
                {t("fileTree.renameConfirmApply")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

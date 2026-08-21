import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface ReplaceConfirmDialogProps {
  fileCount: number;
  matchCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The confirmation step before a vault-wide replace touches disk — "the
 * most dangerous operation in the app," per spec, so it always gets an
 * explicit warning with the affected count before anything is written
 * (on top of the per-match checkboxes and the one-command undo after). */
export function ReplaceConfirmDialog({
  fileCount,
  matchCount,
  onConfirm,
  onCancel,
}: ReplaceConfirmDialogProps) {
  const { t } = useTranslation();
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      ref={backdropRef}
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onCancel();
      }}
    >
      <div className="rename-confirm-modal" role="dialog" aria-modal="true">
        <p className="rename-confirm-title">
          {t("search.replaceWarning", { matchCount, fileCount })}
        </p>
        <div className="rename-confirm-actions">
          <button type="button" className="rename-confirm-cancel" onClick={onCancel}>
            {t("fileTree.renameConfirmCancel")}
          </button>
          <button type="button" className="rename-confirm-apply" onClick={onConfirm}>
            {t("search.applyReplaceConfirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

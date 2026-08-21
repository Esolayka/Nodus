import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { displayName } from "../../lib/displayName";
import "./RenameConfirmDialog.css";

interface RenameConfirmDialogProps {
  affected: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function RenameConfirmDialog({ affected, onConfirm, onCancel }: RenameConfirmDialogProps) {
  const { t } = useTranslation();
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

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
          {t("fileTree.renameConfirmTitle", { count: affected.length })}
        </p>
        <ul className="rename-confirm-list">
          {affected.map((path) => (
            <li key={path}>{displayName(path)}</li>
          ))}
        </ul>
        <div className="rename-confirm-actions">
          <button type="button" className="rename-confirm-cancel" onClick={onCancel}>
            {t("fileTree.renameConfirmCancel")}
          </button>
          {/* Deliberately not autoFocus: confirming is already reachable via
              the Enter listener below, and focusing this button risked
              catching the tail end of the very Enter keypress that opened
              this dialog (its keyup landing on a freshly-focused button,
              which browsers treat as an immediate native click) — an
              instant, unwanted auto-confirm. */}
          <button type="button" className="rename-confirm-apply" onClick={onConfirm}>
            {t("fileTree.renameConfirmApply")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

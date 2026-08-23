import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { fuzzyMatch } from "../../lib/fuzzyMatch";
import { useVaultStore } from "../../store/vaultStore";
import "../FileTree/RenameConfirmDialog.css";

/** A generic vault-file picker (any file, not just notes) — used for
 * canvas "add card from a vault file" (works for a note, an image, or a
 * PDF alike; the canvas renders each according to its own type). */
export function FilePickerDialog({ onPick, onClose }: { onPick: (path: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  // Zustand selectors used through useSyncExternalStore must return a stable
  // snapshot. Spreading the Set inside the selector created a fresh array on
  // every read, which React treated as a store change and re-rendered until
  // the entire application hit "Maximum update depth exceeded".
  const allFilePaths = useVaultStore((s) => s.noteIndex.allFilePaths);
  const allFiles = useMemo(() => [...allFilePaths].sort((a, b) => a.localeCompare(b)), [allFilePaths]);
  const [query, setQuery] = useState("");
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

  const matches = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return allFiles.slice(0, 50);
    return allFiles.filter((p) => fuzzyMatch(trimmed, p)).slice(0, 50);
  }, [allFiles, query]);

  return createPortal(
    <div className="settings-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rename-confirm-modal" role="dialog" aria-modal="true">
        <p className="rename-confirm-title">{t("canvas.pickFileTitle")}</p>
        <input
          ref={inputRef}
          className="field"
          style={{ padding: "8px 10px" }}
          placeholder={t("canvas.pickFilePlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length === 0 ? (
          <p className="side-panel-empty">{t("canvas.pickFileEmpty")}</p>
        ) : (
          <ul className="rename-confirm-list">
            {matches.map((path) => (
              <li key={path}>
                <button type="button" className="template-pick-btn" onClick={() => onPick(path)}>
                  {path}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rename-confirm-actions">
          <button type="button" className="rename-confirm-cancel" onClick={onClose}>
            {t("fileTree.renameConfirmCancel")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

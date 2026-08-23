import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { useVaultStore } from "../../store/vaultStore";
import "../FileTree/RenameConfirmDialog.css";

export function UnusedAttachmentsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.findUnusedAttachments().then((found) => {
      setPaths(found);
      setSelected(new Set(found));
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      for (const path of selected) {
        await api.deleteEntry(path);
      }
      await useVaultStore.getState().refreshTree();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return createPortal(
    <div className="settings-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rename-confirm-modal" role="dialog" aria-modal="true">
        <p className="rename-confirm-title">{t("attachments.unusedTitle")}</p>
        {paths == null ? (
          <p className="side-panel-empty">{t("attachments.scanning")}</p>
        ) : paths.length === 0 ? (
          <p className="side-panel-empty">{t("attachments.noneUnused")}</p>
        ) : (
          <ul className="rename-confirm-list">
            {paths.map((path) => (
              <li key={path} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={selected.has(path)}
                  onChange={() => toggle(path)}
                  style={{ flexShrink: 0 }}
                />
                <span>{path}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="rename-confirm-actions">
          <button type="button" className="rename-confirm-cancel" onClick={onClose}>
            {t("fileTree.renameConfirmCancel")}
          </button>
          {paths != null && paths.length > 0 && (
            <button
              type="button"
              className="rename-confirm-apply"
              onClick={() => void deleteSelected()}
              disabled={deleting || selected.size === 0}
            >
              {t("attachments.deleteSelected", { count: selected.size })}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

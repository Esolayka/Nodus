import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { formatDate } from "../../lib/dateFormat";
import { useVaultStore } from "../../store/vaultStore";
import type { DisplayLine, VersionInfo } from "../../types/vault";
import "../FileTree/RenameConfirmDialog.css";
import "./HistoryPanel.css";

function formatTimestamp(unixSeconds: number): string {
  return formatDate(new Date(unixSeconds * 1000), "YYYY-MM-DD HH:mm");
}

function DiffView({ lines }: { lines: DisplayLine[] }) {
  return (
    <div className="history-diff">
      {lines.map((line, i) => (
        <div key={i} className={`history-diff-line history-diff-${line.kind}`}>
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}

function RestoreConfirmDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="settings-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rename-confirm-modal" role="dialog" aria-modal="true">
        <p className="rename-confirm-title">{t("history.restoreConfirmTitle")}</p>
        <div className="rename-confirm-actions">
          <button type="button" className="rename-confirm-cancel" onClick={onClose}>
            {t("fileTree.renameConfirmCancel")}
          </button>
          <button type="button" className="rename-confirm-apply" onClick={onConfirm}>
            {t("history.restoreConfirmApply")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function VersionViewerModal({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="settings-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="history-viewer-modal" role="dialog" aria-modal="true">
        <div className="history-viewer-header">
          <span>{title}</span>
          <button type="button" className="settings-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <pre className="history-viewer-content">{content}</pre>
      </div>
    </div>,
    document.body,
  );
}

export function HistoryPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [diffLines, setDiffLines] = useState<DisplayLine[] | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [viewer, setViewer] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setDiffLines(null);
    api.getNoteVersions(path).then((v) => setVersions([...v].reverse()));
  }, [path, changeVersion]);

  async function select(id: number) {
    setSelectedId(id);
    const lines = await api.compareVersionToCurrent(path, id);
    setDiffLines(lines);
  }

  async function copyVersionText(id: number) {
    const content = await api.getVersionContent(path, id);
    if (content != null) await navigator.clipboard.writeText(content);
  }

  async function openViewer(id: number) {
    const content = await api.getVersionContent(path, id);
    const version = versions.find((v) => v.id === id);
    if (content != null && version) {
      setViewer({ title: `${path} — ${formatTimestamp(version.timestamp)}`, content });
    }
  }

  async function restore(id: number) {
    await api.restoreVersion(path, id);
    setConfirmingRestore(false);
    useVaultStore.getState().bumpChangeVersion();
  }

  return (
    <div className="history-panel">
      {versions.length === 0 ? (
        <p className="side-panel-empty">{t("history.empty")}</p>
      ) : (
        <ul className="history-version-list">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className={`history-version-row${selectedId === v.id ? " active" : ""}`}
                onClick={() => void select(v.id)}
              >
                <span className="history-version-time">{formatTimestamp(v.timestamp)}</span>
                <span className="history-version-stat">
                  <span className="history-stat-added">+{v.added}</span>{" "}
                  <span className="history-stat-removed">−{v.removed}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedId != null && diffLines && (
        <div className="history-compare">
          <h3 className="side-panel-heading">{t("history.compareTitle")}</h3>
          <DiffView lines={diffLines} />
          <div className="history-compare-actions">
            <button type="button" onClick={() => setConfirmingRestore(true)}>
              {t("history.restoreButton")}
            </button>
            <button type="button" onClick={() => void copyVersionText(selectedId)}>
              {t("history.copyButton")}
            </button>
            <button type="button" onClick={() => void openViewer(selectedId)}>
              {t("history.openButton")}
            </button>
          </div>
        </div>
      )}

      {confirmingRestore && selectedId != null && (
        <RestoreConfirmDialog onConfirm={() => void restore(selectedId)} onClose={() => setConfirmingRestore(false)} />
      )}
      {viewer && <VersionViewerModal title={viewer.title} content={viewer.content} onClose={() => setViewer(null)} />}
    </div>
  );
}

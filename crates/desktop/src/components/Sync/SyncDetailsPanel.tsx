import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useServerSyncStore } from "../../store/serverSyncStore";
import { useSyncStore } from "../../store/syncStore";
import "./SyncDetailsPanel.css";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export function SyncDetailsPanel({
  onClose,
  mechanism,
}: {
  onClose: () => void;
  mechanism: "git" | "server";
}) {
  const { t } = useTranslation();
  const git = {
    status: useSyncStore((s) => s.status),
    enabled: useSyncStore((s) => s.enabled),
    lastError: useSyncStore((s) => s.lastError),
    log: useSyncStore((s) => s.log),
    clearLog: useSyncStore((s) => s.clearLog),
  };
  const server = {
    status: useServerSyncStore((s) => s.status),
    enabled: useServerSyncStore((s) => s.enabled),
    lastError: useServerSyncStore((s) => s.lastError),
    log: useServerSyncStore((s) => s.log),
    clearLog: useServerSyncStore((s) => s.clearLog),
  };
  const { status, enabled, lastError, log, clearLog } = mechanism === "server" ? server : git;

  return createPortal(
    <div className="sync-details-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sync-details-panel" role="dialog" aria-modal="true">
        <div className="sync-details-header">
          <h3>{t("syncDetails.title")}</h3>
          <button type="button" className="settings-close" aria-label={t("settings.close")} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="sync-details-status">
          <span>{t("syncDetails.status")}</span>
          <strong>{enabled ? t(`statusBar.sync_${status}`) : t("statusBar.syncDisabled")}</strong>
        </div>
        {lastError && <p className="git-error">{lastError}</p>}
        <div className="sync-details-log-header">
          <span>{t("syncDetails.log")}</span>
          {log.length > 0 && (
            <button type="button" onClick={clearLog}>
              {t("syncDetails.clearLog")}
            </button>
          )}
        </div>
        {log.length === 0 ? (
          <p className="side-panel-empty">{t("syncDetails.logEmpty")}</p>
        ) : (
          <ul className="sync-log-list">
            {log.map((entry) => (
              <li key={entry.id} className={`sync-log-row sync-log-row-${entry.level}`}>
                <span className="sync-log-time">{formatTime(entry.time)}</span>
                <span className="sync-log-message">{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

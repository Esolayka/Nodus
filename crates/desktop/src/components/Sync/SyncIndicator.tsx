import { useTranslation } from "react-i18next";
import { useServerSyncStore } from "../../store/serverSyncStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useSyncStore } from "../../store/syncStore";
import { SyncDetailsPanel } from "./SyncDetailsPanel";
import "./SyncIndicator.css";

export function SyncIndicator() {
  const { t } = useTranslation();
  const mechanism = useSettingsStore((s) => s.settings.sync.mechanism);
  const gitEnabled = useSyncStore((s) => s.enabled);
  const gitStatus = useSyncStore((s) => s.status);
  const gitDetailsOpen = useSyncStore((s) => s.detailsOpen);
  const setGitDetailsOpen = useSyncStore((s) => s.setDetailsOpen);
  const serverEnabled = useServerSyncStore((s) => s.enabled);
  const serverStatus = useServerSyncStore((s) => s.status);
  const serverDetailsOpen = useServerSyncStore((s) => s.detailsOpen);
  const setServerDetailsOpen = useServerSyncStore((s) => s.setDetailsOpen);

  if (mechanism === "none") return null;

  const isServer = mechanism === "server";
  const enabled = isServer ? serverEnabled : gitEnabled;
  const status = isServer ? serverStatus : gitStatus;
  const detailsOpen = isServer ? serverDetailsOpen : gitDetailsOpen;
  const setDetailsOpen = isServer ? setServerDetailsOpen : setGitDetailsOpen;

  const effectiveStatus = enabled ? status : "idle";
  const label = enabled ? t(`statusBar.sync_${effectiveStatus}`) : t("statusBar.syncDisabled");

  return (
    <>
      <button
        type="button"
        className={`status-item sync-indicator sync-indicator-${enabled ? effectiveStatus : "disabled"}`}
        onClick={() => setDetailsOpen(!detailsOpen)}
      >
        <span className="sync-indicator-dot" />
        {label}
      </button>
      {detailsOpen && <SyncDetailsPanel onClose={() => setDetailsOpen(false)} mechanism={isServer ? "server" : "git"} />}
    </>
  );
}

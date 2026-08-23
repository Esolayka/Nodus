import { AlertTriangle, Check, GitMerge, RefreshCw, WifiOff } from "lucide-react";
import { useLinkStore } from "../store/linkStore";

const LABELS: Record<string, string> = {
  synced: "Synced",
  syncing: "Syncing…",
  offline: "Offline — changes will send later",
  error: "Sync error",
  conflict: "Conflict — check the affected note",
};

const ICONS: Record<string, React.ReactNode> = {
  synced: <Check size={13} />,
  syncing: <RefreshCw size={13} />,
  offline: <WifiOff size={13} />,
  error: <AlertTriangle size={13} />,
  conflict: <GitMerge size={13} />,
};

export function SyncIndicator() {
  const status = useLinkStore((s) => s.status);
  const lastError = useLinkStore((s) => s.lastError);

  return (
    <div className={`miniapp-sync-indicator miniapp-sync-${status}`} title={lastError ?? undefined}>
      {ICONS[status] ?? null}
      <span>{LABELS[status] ?? status}</span>
    </div>
  );
}

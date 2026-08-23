import { useLinkStore } from "../store/linkStore";

const LABELS: Record<string, string> = {
  synced: "Synced",
  syncing: "Syncing…",
  offline: "Offline — changes will send later",
  error: "Sync error",
  conflict: "Conflict — check the affected note",
};

export function SyncIndicator() {
  const status = useLinkStore((s) => s.status);
  const lastError = useLinkStore((s) => s.lastError);

  return (
    <div className={`miniapp-sync-indicator miniapp-sync-${status}`} title={lastError ?? undefined}>
      <span className="miniapp-sync-dot" />
      {LABELS[status] ?? status}
    </div>
  );
}

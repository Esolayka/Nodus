import { AlertTriangle, Check, GitMerge, RefreshCw, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLinkStore } from "../store/linkStore";

const ICONS: Record<string, React.ReactNode> = {
  synced: <Check size={13} />,
  syncing: <RefreshCw size={13} />,
  offline: <WifiOff size={13} />,
  error: <AlertTriangle size={13} />,
  conflict: <GitMerge size={13} />,
};

export function SyncIndicator() {
  const { t } = useTranslation();
  const status = useLinkStore((s) => s.status);
  const lastError = useLinkStore((s) => s.lastError);

  return (
    <div className={`miniapp-sync-indicator miniapp-sync-${status}`} title={lastError ?? undefined}>
      {ICONS[status] ?? null}
      <span>{t(`miniapp.sync.${status}`, status)}</span>
    </div>
  );
}

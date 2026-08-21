import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../store/workspaceStore";
import { Tooltip } from "./ui/Tooltip";
import "./Ribbon.css";

interface RibbonProps {
  onOpenFolder: () => void;
  onOpenSettings: () => void;
}

export function Ribbon({ onOpenFolder, onOpenSettings }: RibbonProps) {
  const { t } = useTranslation();
  const openGraph = useWorkspaceStore((s) => s.openGraph);
  const graphActive = useWorkspaceStore((s) =>
    s.panes.some((p) => p.id === s.activePaneId && p.view === "graph"),
  );

  return (
    <div className="ribbon">
      <Tooltip label={t("sidebar.openFolder")} placement="right">
        <button type="button" className="ribbon-btn" onClick={onOpenFolder}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label={t("graph.title")} placement="right">
        <button
          type="button"
          className={`ribbon-btn${graphActive ? " ribbon-btn-active" : ""}`}
          onClick={() => openGraph()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="5.5" cy="17" r="2.5" />
            <circle cx="18.5" cy="6" r="2.5" />
            <circle cx="12" cy="18" r="2.5" />
            <path d="M7.5 15.5 16.5 7.5M8 17.5l2.5-1.2M15.5 7l-2 2.5" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label={t("settings.title")} placement="right">
        <button type="button" className="ribbon-btn" onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}
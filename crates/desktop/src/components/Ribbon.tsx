import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { sidebarViewRegistry } from "../lib/sidebarViewRegistry";
import { useUiStore } from "../store/uiStore";
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
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarView = useUiStore((s) => s.setSidebarView);
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const allPluginSidebarViews = useSyncExternalStore(sidebarViewRegistry.subscribe, sidebarViewRegistry.getSnapshot);
  // Bookmarks moved to the title bar (it's a popover-style action, not a
  // section switch) — its trigger lives in TitleBar.tsx now, this just
  // keeps the same registry entry from rendering twice.
  const pluginSidebarViews = allPluginSidebarViews.filter((v) => v.id !== "core.bookmarks");

  function showSidebarView(view: string) {
    if (!sidebarCollapsed && sidebarView === view) {
      toggleSidebarCollapsed();
    } else {
      setSidebarView(view);
      if (sidebarCollapsed) toggleSidebarCollapsed();
    }
  }

  return (
    <div className="ribbon">
      <Tooltip label={t("sidebar.openFolder")} placement="right">
        <button
          type="button"
          className="ribbon-btn"
          onClick={onOpenFolder}
        >
          <FolderOpen size={18} strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip label={t("tags.title")} placement="right">
        <button
          type="button"
          className={`ribbon-btn${!sidebarCollapsed && sidebarView === "tags" ? " ribbon-btn-active" : ""}`}
          onClick={() => showSidebarView("tags")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M9 3 7.5 21M16.5 3 15 21M3.5 8.5h17M2.5 15.5h17" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label={t("tasks.title")} placement="right">
        <button
          type="button"
          className={`ribbon-btn${!sidebarCollapsed && sidebarView === "tasks" ? " ribbon-btn-active" : ""}`}
          onClick={() => showSidebarView("tasks")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M4 6h2l1.5 1.5L10 5M4 12h2l1.5 1.5L10 10M4 18h2l1.5 1.5L10 16M13 6h7M13 12h7M13 18h7" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label={t("calendar.title")} placement="right">
        <button
          type="button"
          className={`ribbon-btn${!sidebarCollapsed && sidebarView === "calendar" ? " ribbon-btn-active" : ""}`}
          onClick={() => showSidebarView("calendar")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
            <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label={t("git.title")} placement="right">
        <button
          type="button"
          className={`ribbon-btn${!sidebarCollapsed && sidebarView === "sync" ? " ribbon-btn-active" : ""}`}
          onClick={() => showSidebarView("sync")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="6" cy="6" r="2.2" />
            <circle cx="6" cy="18" r="2.2" />
            <circle cx="18" cy="12" r="2.2" />
            <path d="M6 8.2V15.8M8.2 12H15.8M8 6.5c4 0 6 2 6 5.5" />
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
      {pluginSidebarViews.map(({ id, titleKey, icon: Icon }) => (
        <Tooltip key={id} label={t(titleKey)} placement="right">
          <button
            type="button"
            className={`ribbon-btn${!sidebarCollapsed && sidebarView === id ? " ribbon-btn-active" : ""}`}
            onClick={() => showSidebarView(id)}
          >
            <Icon size={18} />
          </button>
        </Tooltip>
      ))}
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

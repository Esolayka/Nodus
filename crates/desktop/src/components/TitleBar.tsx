import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bookmark, ChevronDown, FolderOpen, Minus, PanelLeft, PanelRight, Search, Square, X } from "lucide-react";
import { displayName } from "../lib/displayName";
import { isEmptyTab, useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { Tooltip } from "./ui/Tooltip";
import { TabBar } from "./Workspace/TabBar";
import "./TitleBar.css";

async function windowAction(action: "minimize" | "maximize" | "close") {
  let appWindow: ReturnType<typeof getCurrentWindow>;
  try {
    appWindow = getCurrentWindow();
  } catch {
    // getCurrentWindow() itself throws synchronously outside a Tauri window
    // (e.g. plain browser) — nothing to do in that environment.
    return;
  }
  try {
    if (action === "minimize") await appWindow.minimize();
    else if (action === "maximize") await appWindow.toggleMaximize();
    else await appWindow.close();
  } catch (error) {
    // A real failure here (permission denied, IPC error, ...) should be
    // visible, not silently swallowed — that's exactly what made this
    // class of bug invisible last time.
    console.error(`[titlebar] ${action} failed:`, error);
  }
}

function TabListMenu({ paneId, tabs }: { paneId: string; tabs: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="tab-list-menu-wrap" ref={wrapRef}>
      <Tooltip label={t("workspace.tabList")} placement="bottom">
        <button type="button" className="titlebar-app-btn" onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={16} />
        </button>
      </Tooltip>
      {open && (
        <div className="tab-list-menu">
          {tabs.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => {
                setActiveTab(paneId, path);
                setOpen(false);
              }}
            >
              {isEmptyTab(path) ? t("workspace.newTab") : displayName(path)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TitleBar({ onOpenFolder }: { onOpenFolder: () => void }) {
  const { t } = useTranslation();
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const toggleRightPanelCollapsed = useUiStore((s) => s.toggleRightPanelCollapsed);
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarView = useUiStore((s) => s.setSidebarView);
  const panes = useWorkspaceStore((s) => s.panes);
  const singlePane = panes.length === 1 ? panes[0] : null;

  // Actions that open something *over* the current view (a sidebar panel
  // swap counts, since it isn't switching which section of the workspace
  // you're in the way Files/Graph/Tags do) live in the top bar, next to the
  // tabs — not in the left column, which is reserved for section switches.
  function showSidebarView(view: string) {
    if (!sidebarCollapsed && sidebarView === view) {
      toggleSidebarCollapsed();
    } else {
      setSidebarView(view);
      if (sidebarCollapsed) toggleSidebarCollapsed();
    }
  }

  return (
    <header className="titlebar">
      <Tooltip label={t("sidebar.toggle")} placement="bottom">
        <button type="button" className="titlebar-app-btn" onClick={toggleSidebarCollapsed}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip label={t("sidebar.openFolder")} placement="bottom">
        <button type="button" className="titlebar-app-btn" onClick={onOpenFolder}>
          <FolderOpen size={16} strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip label={t("search.title")} placement="bottom">
        <button
          type="button"
          className={`titlebar-app-btn${!sidebarCollapsed && sidebarView === "search" ? " active" : ""}`}
          onClick={() => showSidebarView("search")}
        >
          <Search size={16} strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip label={t("plugins.bookmarks.title")} placement="bottom">
        <button
          type="button"
          className={`titlebar-app-btn${!sidebarCollapsed && sidebarView === "core.bookmarks" ? " active" : ""}`}
          onClick={() => showSidebarView("core.bookmarks")}
        >
          <Bookmark size={16} strokeWidth={1.75} />
        </button>
      </Tooltip>
      {singlePane && <TabBar pane={singlePane} />}
      {singlePane && singlePane.tabs.length > 0 && (
        <TabListMenu paneId={singlePane.id} tabs={singlePane.tabs} />
      )}
      <div className="titlebar-drag-fill" data-tauri-drag-region />
      <div className="titlebar-controls">
        <Tooltip label={t("rightPanel.toggle")} placement="bottom">
          <button type="button" className="titlebar-app-btn" onClick={toggleRightPanelCollapsed}>
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.minimize")} placement="bottom">
          <button type="button" className="titlebar-app-btn" onClick={() => void windowAction("minimize")}>
            <Minus size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.maximize")} placement="bottom">
          <button type="button" className="titlebar-app-btn" onClick={() => void windowAction("maximize")}>
            <Square size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.close")} placement="bottom">
          <button type="button" className="titlebar-app-btn titlebar-close" onClick={() => void windowAction("close")}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

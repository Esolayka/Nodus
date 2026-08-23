import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bookmark, ChevronDown, Folder, Minus, PanelLeft, PanelRight, Search, Square, X } from "lucide-react";
import { displayName } from "../lib/displayName";
import {
  GRAPH_TAB_ID,
  isEmptyTab,
  orderedPaneTabIds,
  useWorkspaceStore,
  type Pane,
} from "../store/workspaceStore";
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

function TabListMenu({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tabs = orderedPaneTabIds(pane);

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
                if (path === GRAPH_TAB_ID) setActiveView(pane.id, "graph");
                else setActiveTab(pane.id, path);
                setOpen(false);
              }}
            >
              {path === GRAPH_TAB_ID
                ? t("graph.title")
                : isEmptyTab(path)
                  ? t("workspace.newTab")
                  : displayName(path)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TitleBar() {
  const { t } = useTranslation();
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const toggleRightPanelCollapsed = useUiStore((s) => s.toggleRightPanelCollapsed);
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const setSidebarView = useUiStore((s) => s.setSidebarView);
  const setSearchOptionsOpen = useUiStore((s) => s.setSearchOptionsOpen);
  const panes = useWorkspaceStore((s) => s.panes);
  const singlePane = panes.length === 1 ? panes[0] : null;

  // The primary file view follows Obsidian's placement in the top bar;
  // auxiliary sidebar views remain in the vertical ribbon.
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
      <Tooltip label={t("sidebar.filesView")} placement="bottom">
        <button
          type="button"
          className={`titlebar-app-btn${!sidebarCollapsed && sidebarView === "files" ? " active" : ""}`}
          onClick={() => showSidebarView("files")}
        >
          <Folder size={16} strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip label={t("search.title")} placement="bottom">
        <button
          type="button"
          className={`titlebar-app-btn${!sidebarCollapsed && sidebarView === "search" ? " active" : ""}`}
          onClick={() => {
            const opening = sidebarCollapsed || sidebarView !== "search";
            showSidebarView("search");
            setSearchOptionsOpen(opening);
          }}
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
      <div className="titlebar-drag-fill" data-tauri-drag-region />
      {singlePane && <TabBar pane={singlePane} />}
      <div className="titlebar-drag-fill" data-tauri-drag-region />
      {/* Everything from here on is one adjacent cluster pinned to the true
          right edge — it must never depend on the right panel's own width
          (that's what previously left a gap that grew/shrank with the
          panel, since the window controls lived in a separate, independently
          right-aligned column). */}
      {singlePane && <TabListMenu pane={singlePane} />}
      <Tooltip label={t("rightPanel.toggle")} placement="bottom">
        <button
          type="button"
          className={`titlebar-app-btn${!rightPanelCollapsed ? " active" : ""}`}
          aria-pressed={!rightPanelCollapsed}
          onClick={toggleRightPanelCollapsed}
        >
          <PanelRight size={16} strokeWidth={1.75} />
        </button>
      </Tooltip>
      <div className="titlebar-controls">
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

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, PanelLeft, PanelRight } from "lucide-react";
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

export function TitleBar() {
  const { t } = useTranslation();
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const toggleRightPanelCollapsed = useUiStore((s) => s.toggleRightPanelCollapsed);
  const panes = useWorkspaceStore((s) => s.panes);
  const singlePane = panes.length === 1 ? panes[0] : null;

  return (
    <header className="titlebar">
      <Tooltip label={t("sidebar.toggle")} placement="bottom">
        <button type="button" className="titlebar-app-btn" onClick={toggleSidebarCollapsed}>
          <PanelLeft size={16} />
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
            <PanelRight size={16} />
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.minimize")} placement="bottom">
          <button type="button" className="titlebar-app-btn" onClick={() => void windowAction("minimize")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M3 8h10" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.maximize")} placement="bottom">
          <button type="button" className="titlebar-app-btn" onClick={() => void windowAction("maximize")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.close")} placement="bottom">
          <button type="button" className="titlebar-app-btn titlebar-close" onClick={() => void windowAction("close")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

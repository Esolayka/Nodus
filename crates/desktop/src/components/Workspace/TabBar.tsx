import { FileText, Network, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { displayName } from "../../lib/displayName";
import { isEmptyTab } from "../../store/workspaceStore";
import type { Pane } from "../../store/workspaceStore";

function fileIcon() {
  return <FileText size={14} strokeWidth={1.75} />;
}

function graphIcon() {
  return <Network size={14} strokeWidth={1.75} />;
}

export function TabBar({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const buffers = useWorkspaceStore((s) => s.buffers);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closeView = useWorkspaceStore((s) => s.closeView);
  const openEmptyTab = useWorkspaceStore((s) => s.openEmptyTab);
  const setQuickSwitcherOpen = useUiStore((s) => s.setQuickSwitcherOpen);

  return (
    <div className="tab-bar" role="tablist">
      {pane.graphOpen && (
        <div
          role="tab"
          aria-selected={pane.view === "graph"}
          className={`tab${pane.view === "graph" ? " tab-active" : ""}`}
          onClick={() => setActiveView(pane.id, "graph")}
        >
          <span className="tab-icon">{graphIcon()}</span>
          <span className="tab-name">{t("graph.title")}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={t("workspace.closeTab")}
            onClick={(e) => {
              e.stopPropagation();
              closeView(pane.id);
            }}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      )}
      {pane.tabs.map((path) => {
        const dirty = buffers[path]?.dirty;
        const active = pane.view === null && path === pane.activePath;
        const blank = isEmptyTab(path);
        return (
          <div
            key={path}
            role="tab"
            aria-selected={active}
            className={`tab${active ? " tab-active" : ""}`}
            onClick={() => setActiveTab(pane.id, path)}
            title={blank ? undefined : path}
          >
            <span className="tab-icon">
              {!blank && dirty ? <span className="tab-dirty-dot" /> : fileIcon()}
            </span>
            <span className="tab-name">{blank ? t("workspace.newTab") : displayName(path)}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={t("workspace.closeTab")}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(pane.id, path);
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="tab-add"
        aria-label={t("workspace.newTab")}
        onClick={() => {
          openEmptyTab();
          setQuickSwitcherOpen(true);
        }}
        title={t("workspace.newTab")}
      >
        <Plus size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

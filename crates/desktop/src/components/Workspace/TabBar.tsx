import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { displayName } from "../../lib/displayName";
import { isEmptyTab } from "../../store/workspaceStore";
import type { Pane } from "../../store/workspaceStore";

function fileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 2h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function graphIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="4" cy="11.5" r="1.8" />
      <circle cx="12" cy="4.5" r="1.8" />
      <circle cx="8" cy="12.5" r="1.8" />
      <path d="M5.5 10.5 10.5 5.5M5.8 11.8l1.7-.6M10.3 5.3l-1.4 1.7" />
    </svg>
  );
}

export function TabBar({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const buffers = useWorkspaceStore((s) => s.buffers);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closeView = useWorkspaceStore((s) => s.closeView);
  const openEmptyTab = useWorkspaceStore((s) => s.openEmptyTab);

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
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
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
        onClick={() => openEmptyTab()}
        title={t("workspace.newTab")}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
    </div>
  );
}
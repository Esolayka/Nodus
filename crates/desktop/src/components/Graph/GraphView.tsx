import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGraphData } from "../../hooks/useGraphData";
import { useSettingsStore } from "../../store/settingsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { ForceGraph } from "./ForceGraph";
import "./GraphView.css";

export function GraphView() {
  const { t } = useTranslation();
  const { data } = useGraphData();
  const [localMode, setLocalMode] = useState(false);
  const graphSettings = useSettingsStore((s) => s.settings.graph);
  const openNote = useWorkspaceStore((s) => s.openNote);
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
  });

  const focusPath = localMode ? activePath : undefined;

  const corner = data ? (
    <div className="graph-view-corner">
      <div className="graph-view-corner-row">
        <button
          type="button"
          className={`graph-view-toggle${localMode ? " active" : ""}`}
          onClick={() => setLocalMode((v) => !v)}
          title={t("graph.localModeTitle")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="5" cy="8" r="2.2" />
            <circle cx="11" cy="4.5" r="1.6" />
            <circle cx="11" cy="11.5" r="1.6" />
            <path d="M6.6 7.2 9.6 5M6.6 8.8l3 2.7" />
          </svg>
        </button>
        <span className="graph-view-badge">
          {localMode
            ? `${t("graph.localMode")} · ${t("graph.nodeCount", { count: data.nodes.length })}`
            : t("graph.nodeCount", { count: data.nodes.length })}
        </span>
      </div>
      {data.nodes.length > 0 && data.links.length === 0 && (
        <p className="graph-view-hint">{t("graph.noLinksHint")}</p>
      )}
    </div>
  ) : null;

  return (
    <div className="graph-view">
      {corner}
      {data && data.nodes.length > 0 ? (
        <ForceGraph
          data={data}
          focusPath={focusPath ?? null}
          localDepth={graphSettings.localDepth}
          onOpenNote={(path, opts) => void openNote(path, opts)}
        />
      ) : (
        <div className="graph-view-empty">
          {data ? t("graph.empty") : t("graph.loading")}
        </div>
      )}
    </div>
  );
}
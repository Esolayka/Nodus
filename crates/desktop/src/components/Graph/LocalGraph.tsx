import { useTranslation } from "react-i18next";
import { useGraphData } from "../../hooks/useGraphData";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { ForceGraph } from "./ForceGraph";

/** Compact local graph for the right sidebar: current note plus its
 * immediate neighborhood (one hop, like Obsidian). */
export function LocalGraph() {
  const { t } = useTranslation();
  const { data, error } = useGraphData();
  const openNote = useWorkspaceStore((s) => s.openNote);
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
  });

  if (error) {
    return <p className="side-panel-empty">{t("graph.loadError")}</p>;
  }

  if (!data || !activePath) {
    return <p className="side-panel-empty">{t("graph.empty")}</p>;
  }

  return (
    <div className="local-graph">
      <ForceGraph
        data={data}
        focusPath={activePath}
        localDepth={1}
        onOpenNote={(path) => void openNote(path)}
        compact
      />
    </div>
  );
}

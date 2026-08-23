import { useTranslation } from "react-i18next";
import { useGraphData } from "../../hooks/useGraphData";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { ForceGraph } from "./ForceGraph";
import "./GraphView.css";

export function GraphView() {
  const { t } = useTranslation();
  const { data } = useGraphData();
  const openNote = useWorkspaceStore((s) => s.openNote);

  return (
    <div className="graph-view">
      {data && data.nodes.length > 0 ? (
        <ForceGraph
          data={data}
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

import { useTranslation } from "react-i18next";
import { useGraphData } from "../../hooks/useGraphData";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { ForceGraph } from "./ForceGraph";
import "./GraphView.css";

export function GraphView() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useGraphData();
  const openNote = useWorkspaceStore((s) => s.openNote);

  return (
    <div className="graph-view">
      {error ? (
        <div className="graph-view-empty graph-view-error" role="alert">
          <span>{t("graph.loadError")}</span>
          <code>{error}</code>
          <button type="button" onClick={() => void reload()}>
            {t("graph.retry")}
          </button>
        </div>
      ) : data && data.nodes.length > 0 ? (
        <ForceGraph
          data={data}
          onOpenNote={(path, opts) => void openNote(path, opts)}
        />
      ) : (
        <div className="graph-view-empty">
          {loading || !data ? t("graph.loading") : t("graph.empty")}
        </div>
      )}
    </div>
  );
}

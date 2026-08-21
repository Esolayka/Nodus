import { useWorkspaceStore } from "../../store/workspaceStore";
import { Pane } from "./Pane";
import "./Workspace.css";

export function PaneGroup() {
  const panes = useWorkspaceStore((s) => s.panes);
  const activePaneId = useWorkspaceStore((s) => s.activePaneId);

  return (
    <div className="pane-group">
      {panes.map((pane) => (
        <Pane key={pane.id} pane={pane} isActive={pane.id === activePaneId} />
      ))}
    </div>
  );
}

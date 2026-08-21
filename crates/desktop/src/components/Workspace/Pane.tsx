import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { Pane as PaneModel } from "../../store/workspaceStore";
import { ExternalChangeBar } from "../Editor/ExternalChangeBar";
import { GraphView } from "../Graph/GraphView";
import { NoteEditor } from "../Editor/NoteEditor";
import { PathBar } from "./PathBar";
import { TabBar } from "./TabBar";

export function Pane({ pane, isActive }: { pane: PaneModel; isActive: boolean }) {
  const { t } = useTranslation();
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const paneCount = useWorkspaceStore((s) => s.panes.length);
  const hasConflict = useWorkspaceStore((s) =>
    pane.activePath ? (s.buffers[pane.activePath]?.externalConflict ?? false) : false,
  );

  return (
    <div
      className={`pane${isActive ? " pane-active" : ""}`}
      onMouseDown={() => setActivePane(pane.id)}
    >
      <div className="pane-header">
        <TabBar pane={pane} />
        {paneCount > 1 && (
          <button
            type="button"
            className="pane-close"
            aria-label={t("workspace.closePane")}
            onClick={() => closePane(pane.id)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>
      {pane.view === null && pane.activePath && <PathBar pane={pane} />}
      {pane.view === null && pane.activePath && hasConflict && (
        <ExternalChangeBar path={pane.activePath} />
      )}
      <div className="pane-body">
        {pane.view === "graph" ? (
          <GraphView />
        ) : pane.activePath ? (
          <NoteEditor path={pane.activePath} />
        ) : (
          <p className="pane-empty">{t("workspace.placeholder")}</p>
        )}
      </div>
    </div>
  );
}

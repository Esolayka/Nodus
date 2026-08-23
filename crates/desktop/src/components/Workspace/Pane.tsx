import { useTranslation } from "react-i18next";
import { isPdfPath } from "../../lib/attachments";
import { isCanvasPath } from "../../lib/canvasTypes";
import { isEmptyTab, useWorkspaceStore } from "../../store/workspaceStore";
import type { Pane as PaneModel } from "../../store/workspaceStore";
import { CanvasTab } from "../Canvas/CanvasTab";
import { ExternalChangeBar } from "../Editor/ExternalChangeBar";
import { GraphView } from "../Graph/GraphView";
import { NoteEditor } from "../Editor/NoteEditor";
import { PdfViewerTab } from "../Pdf/PdfViewerTab";
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
  const hasRealNote = pane.activePath != null && !isEmptyTab(pane.activePath);

  return (
    <div
      className={`pane${isActive ? " pane-active" : ""}`}
      onMouseDown={() => setActivePane(pane.id)}
    >
      {/* A single pane's tabs live in the title bar instead (one 40px row,
          not two) — this row only exists at all once a split makes "which
          pane's tabs are these" ambiguous. */}
      {paneCount > 1 && (
        <div className="pane-header">
          <TabBar pane={pane} />
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
        </div>
      )}
      {pane.view === null && hasRealNote && <PathBar pane={pane} />}
      {pane.view === null && hasRealNote && hasConflict && (
        <ExternalChangeBar path={pane.activePath as string} />
      )}
      <div className="pane-body">
        {pane.view === "graph" ? (
          <GraphView />
        ) : hasRealNote ? (
          isPdfPath(pane.activePath as string) ? (
            <PdfViewerTab path={pane.activePath as string} />
          ) : isCanvasPath(pane.activePath as string) ? (
            <CanvasTab path={pane.activePath as string} />
          ) : (
            <NoteEditor path={pane.activePath as string} />
          )
        ) : (
          <p className="pane-empty">{t("workspace.placeholder")}</p>
        )}
      </div>
    </div>
  );
}

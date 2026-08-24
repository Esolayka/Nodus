import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileText, Network, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { displayName } from "../../lib/displayName";
import {
  GRAPH_TAB_ID,
  isEmptyTab,
  orderedPaneTabIds,
  useWorkspaceStore,
  type Pane,
} from "../../store/workspaceStore";

interface DropTarget {
  id: string;
  side: "before" | "after";
}

const TAB_DRAG_MIME = "application/x-nodus-tab";

export function TabBar({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const buffers = useWorkspaceStore((s) => s.buffers);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closeView = useWorkspaceStore((s) => s.closeView);
  const reorderTab = useWorkspaceStore((s) => s.reorderTab);
  const openEmptyTab = useWorkspaceStore((s) => s.openEmptyTab);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const tabIds = orderedPaneTabIds(pane);
  const orderKey = tabIds.join("\u0000");
  const activeId = pane.view === "graph" ? GRAPH_TAB_ID : pane.activePath;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const activeTab = [...(stripRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])]
        .find((element) => element.dataset.tabId === activeId);
      activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, orderKey]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  function startDrag(event: DragEvent<HTMLDivElement>, id: string) {
    setDraggedId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TAB_DRAG_MIME, id);
    event.dataTransfer.setData("text/plain", id);
  }

  function dragOver(event: DragEvent<HTMLDivElement>, id: string) {
    const sourceId = draggedId || event.dataTransfer.getData(TAB_DRAG_MIME);
    if (!sourceId || sourceId === id) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    setDropTarget({ id, side });
  }

  function drop(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData(TAB_DRAG_MIME) || draggedId;
    const side = dropTarget?.id === targetId ? dropTarget.side : "before";
    if (sourceId && sourceId !== targetId) {
      const withoutSource = tabIds.filter((id) => id !== sourceId);
      const targetIndex = withoutSource.indexOf(targetId);
      if (targetIndex !== -1) {
        reorderTab(pane.id, sourceId, targetIndex + (side === "after" ? 1 : 0));
      }
    }
    setDraggedId(null);
    setDropTarget(null);
  }

  function endDrag() {
    setDraggedId(null);
    setDropTarget(null);
  }

  function scrollWhileDragging(event: DragEvent<HTMLDivElement>) {
    if (!draggedId) return;
    event.preventDefault();
    const strip = event.currentTarget;
    const bounds = strip.getBoundingClientRect();
    const edge = Math.min(48, bounds.width / 4);
    if (event.clientX < bounds.left + edge) strip.scrollLeft -= 24;
    else if (event.clientX > bounds.right - edge) strip.scrollLeft += 24;
  }

  return (
    <div className="tab-bar">
      <div ref={stripRef} className="tab-strip" role="tablist" onDragOver={scrollWhileDragging}>
        {tabIds.map((id) => {
          const graph = id === GRAPH_TAB_ID;
          const blank = !graph && isEmptyTab(id);
          const active = graph ? pane.view === "graph" : pane.view === null && id === pane.activePath;
          const dirty = !graph && buffers[id]?.dirty;
          const dropClass = dropTarget?.id === id ? ` tab-drop-${dropTarget.side}` : "";
          return (
            <div
              key={id}
              role="tab"
              aria-selected={active}
              data-tab-id={id}
              draggable
              className={`tab${active ? " tab-active" : ""}${draggedId === id ? " tab-dragging" : ""}${dropClass}`}
              onClick={() => graph ? setActiveView(pane.id, "graph") : setActiveTab(pane.id, id)}
              onDragStart={(event) => startDrag(event, id)}
              onDragOver={(event) => dragOver(event, id)}
              onDrop={(event) => drop(event, id)}
              onDragEnd={endDrag}
              title={!graph && !blank ? id : undefined}
            >
              <span className="tab-icon">
                {graph ? (
                  <Network size={14} strokeWidth={1.75} />
                ) : !blank && dirty ? (
                  <span className="tab-dirty-dot" />
                ) : (
                  <FileText size={14} strokeWidth={1.75} />
                )}
              </span>
              <span className="tab-name">
                {graph ? t("graph.title") : blank ? t("workspace.newTab") : displayName(id)}
              </span>
              <button
                type="button"
                className="tab-close"
                aria-label={t("workspace.closeTab")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (graph) closeView(pane.id);
                  else closeTab(pane.id, id);
                }}
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tab-add"
        aria-label={t("workspace.newTab")}
        onClick={() => openEmptyTab()}
        title={t("workspace.newTab")}
      >
        <Plus size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

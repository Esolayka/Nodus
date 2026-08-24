import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { open as openShell } from "@tauri-apps/plugin-shell";
import {
  Boxes,
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FilePlus2,
  Grid3X3,
  ImagePlus,
  Lock,
  Magnet,
  Maximize,
  Minus,
  Palette,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  StickyNote,
  Trash2,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { assetUrlFor } from "../../lib/assetUrl";
import { isPdfPath, mediaKindOf } from "../../lib/attachments";
import {
  emptyCanvas,
  newNodeId,
  parseCanvasWithError,
  serializeCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type GroupNode,
  type Side,
  type TextNode,
} from "../../lib/canvasTypes";
import { useUiStore } from "../../store/uiStore";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { Tooltip } from "../ui/Tooltip";
import { FilePickerDialog, type CanvasFilePickerKind } from "./FilePickerDialog";
import {
  anchorPoint,
  distanceToEdge,
  getEdgeGeometry,
  pointOnBezier,
  render,
  screenToWorld,
  type NodePreview,
  type Point,
  type Transform,
} from "./canvasRender";
import "./CanvasTab.css";

const GRID = 20;
const HANDLE_SIZE = 9;
const ANCHOR_RADIUS = 10;
const MIN_NODE_WIDTH = 80;
const MIN_NODE_HEIGHT = 60;
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const COLOR_CODES: Array<string | null> = [null, "1", "2", "3", "4", "5", "6"];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type EditTarget =
  | { kind: "text"; id: string }
  | { kind: "group"; id: string }
  | { kind: "edge"; id: string };

interface CanvasContextMenuState {
  x: number;
  y: number;
  world: Point;
  nodeId: string | null;
  edgeId: string | null;
}

interface LinkDialogState {
  point: Point;
  value: string;
}

interface ClipboardData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

type Mode =
  | { kind: "idle" }
  | { kind: "panning"; startX: number; startY: number; origin: Transform }
  | { kind: "marquee"; startWorld: Point; currentWorld: Point; additive: boolean }
  | { kind: "dragging"; startWorld: Point; startPositions: Map<string, Point>; changed: boolean }
  | { kind: "resizing"; nodeId: string; handle: string; startWorld: Point; startRect: Rect; changed: boolean }
  | { kind: "connecting"; fromNode: string; fromSide: Side };

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function alignmentValues(rect: Rect): number[] {
  return [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
}

function verticalAlignmentValues(rect: Rect): number[] {
  return [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

function nearestAlignmentOffset(moving: number[], stationary: number[], threshold: number): number | null {
  let best = 0;
  let distance = threshold + 1;
  for (const source of moving) {
    for (const target of stationary) {
      const candidate = target - source;
      if (Math.abs(candidate) < distance) {
        best = candidate;
        distance = Math.abs(candidate);
      }
    }
  }
  return distance <= threshold ? best : null;
}

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: get("--bg-secondary", "#161616"),
    grid: "rgba(127,127,127,0.28)",
    cardBg: get("--bg-primary", "#1e1e1e"),
    cardBorder: get("--border", "rgba(255,255,255,0.12)"),
    text: get("--text-normal", "#dadada"),
    textMuted: get("--text-muted", "#a3a3a3"),
    accent: get("--accent", "#7f6df2"),
    groupBg: "rgba(127,127,127,0.06)",
    groupBorder: "rgba(127,127,127,0.25)",
  };
}

function boundsOf(nodes: CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;
  const x0 = Math.min(...nodes.map((node) => node.x));
  const y0 = Math.min(...nodes.map((node) => node.y));
  const x1 = Math.max(...nodes.map((node) => node.x + node.width));
  const y1 = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function nearestSide(node: CanvasNode, point: Point): Side {
  const distances: Array<[Side, number]> = [
    ["top", Math.abs(point.y - node.y)],
    ["right", Math.abs(point.x - (node.x + node.width))],
    ["bottom", Math.abs(point.y - (node.y + node.height))],
    ["left", Math.abs(point.x - node.x)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

function oppositeSide(side: Side): Side {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  if (side === "left") return "right";
  return "left";
}

function pointInNode(point: Point, node: CanvasNode): boolean {
  return point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height;
}

function nodeInsideGroup(node: CanvasNode, group: GroupNode): boolean {
  if (node.id === group.id) return false;
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  return pointInNode(center, group);
}

function withoutColor<T extends CanvasNode | CanvasEdge>(value: T): T {
  const copy = { ...value };
  delete copy.color;
  return copy;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function CanvasLinkDialog({ state, onChange, onSubmit, onClose }: {
  state: LinkDialogState;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return createPortal(
    <div className="settings-overlay canvas-link-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="canvas-link-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="canvas-link-url">{t("canvas.linkTitle")}</label>
        <input
          id="canvas-link-url"
          className="field"
          autoFocus
          value={state.value}
          placeholder={t("canvas.linkPlaceholder")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div className="canvas-link-actions">
          <button type="button" onClick={onClose}>{t("fileTree.renameConfirmCancel")}</button>
          <button type="submit" className="btn-accent" disabled={!state.value.trim()}>{t("canvas.addLink")}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function CanvasTab({ path }: { path: string }) {
  const { t } = useTranslation();
  const buffer = useWorkspaceStore((state) => state.buffers[path]);
  const updateContent = useWorkspaceStore((state) => state.updateContent);
  const flush = useWorkspaceStore((state) => state.flush);
  const openNote = useWorkspaceStore((state) => state.openNote);
  const setLightboxImageSrc = useUiStore((state) => state.setLightboxImageSrc);
  const allFilePaths = useVaultStore((state) => state.noteIndex.allFilePaths);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const addToolbarRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<CanvasData>(emptyCanvas());
  const dataRef = useRef(data);
  dataRef.current = data;
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const selectedEdgesRef = useRef(selectedEdges);
  selectedEdgesRef.current = selectedEdges;
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const editingRef = useRef<EditTarget | null>(null);
  editingRef.current = editing;
  const [editDraft, setEditDraft] = useState("");
  const [filePickerKind, setFilePickerKind] = useState<CanvasFilePickerKind | null>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draggingEdge, setDraggingEdge] = useState<{ fromNode: string; fromSide: Side; x: number; y: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapToObjects, setSnapToObjects] = useState(true);
  const [readOnly, setReadOnly] = useState(false);

  const modeRef = useRef<Mode>({ kind: "idle" });
  const previewsRef = useRef<Map<string, NodePreview>>(new Map());
  const requestedPreviews = useRef<Set<string>>(new Set());
  const historyRef = useRef<CanvasData[]>([]);
  const historyIndexRef = useRef(-1);
  const loadedPathRef = useRef<string | null>(null);
  const lastSerializedRef = useRef("");
  const spaceHeldRef = useRef(false);
  const clipboardRef = useRef<ClipboardData>({ nodes: [], edges: [] });
  const insertPointRef = useRef<Point | null>(null);

  useEffect(() => {
    if (!buffer) return;
    const contentChangedExternally = loadedPathRef.current === path
      && !buffer.dirty
      && buffer.content !== lastSerializedRef.current;
    if (loadedPathRef.current === path && !contentChangedExternally) return;
    loadedPathRef.current = path;
    lastSerializedRef.current = buffer.content;
    const parsed = parseCanvasWithError(buffer.content);
    setParseError(parsed.error);
    setData(parsed.data);
    setSelection(new Set());
    setSelectedEdges(new Set());
    setEditing(null);
    historyRef.current = [parsed.data];
    historyIndexRef.current = 0;
    previewsRef.current = new Map();
    requestedPreviews.current = new Set();
  }, [path, buffer]);

  function writeBuffer(next: CanvasData) {
    const serialized = serializeCanvas(next);
    lastSerializedRef.current = serialized;
    updateContent(path, serialized);
  }

  function commit(next: CanvasData) {
    if (parseError || readOnly) return;
    dataRef.current = next;
    setData(next);
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(next);
    if (historyRef.current.length > 100) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    writeBuffer(next);
  }

  function undo() {
    if (readOnly || historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    dataRef.current = snapshot;
    setData(snapshot);
    setSelection(new Set());
    setSelectedEdges(new Set());
    writeBuffer(snapshot);
  }

  function redo() {
    if (readOnly || historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    dataRef.current = snapshot;
    setData(snapshot);
    setSelection(new Set());
    setSelectedEdges(new Set());
    writeBuffer(snapshot);
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    render(canvas, {
      data: dataRef.current,
      transform: transformRef.current,
      selection: selectionRef.current,
      selectedEdges: selectedEdgesRef.current,
      draggingEdge,
      marquee,
      previews: previewsRef.current,
      colors: themeColors(),
    });
  }

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, transform, selection, selectedEdges, draggingEdge, marquee]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const alignAddToolbar = () => {
      const toolbar = addToolbarRef.current;
      if (toolbar) toolbar.style.left = `${Math.round((surface.clientWidth - toolbar.offsetWidth) / 2)}px`;
    };
    const observer = new ResizeObserver(() => {
      alignAddToolbar();
      redraw();
    });
    observer.observe(surface);
    if (addToolbarRef.current) observer.observe(addToolbarRef.current);
    alignAddToolbar();
    const themeObserver = new MutationObserver(() => redraw());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-custom-theme", "style"],
    });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    for (const node of data.nodes) {
      if (requestedPreviews.current.has(node.id)) continue;
      if (node.type === "group" && node.background) {
        requestedPreviews.current.add(node.id);
        const image = new Image();
        image.onload = () => {
          previewsRef.current.set(node.id, { kind: "image", img: image });
          redraw();
        };
        image.src = assetUrlFor(node.background);
        continue;
      }
      if (node.type !== "file") continue;
      requestedPreviews.current.add(node.id);
      const kind = mediaKindOf(node.file);
      if (kind === "image") {
        const image = new Image();
        image.onload = () => {
          previewsRef.current.set(node.id, { kind: "image", img: image });
          redraw();
        };
        image.src = assetUrlFor(node.file);
      } else if (node.file.toLowerCase().endsWith(".md")) {
        void api.readNote(node.file).then((content) => {
          previewsRef.current.set(node.id, { kind: "text", lines: content.split("\n").slice(0, 60) });
          redraw();
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.nodes]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest(".canvas-context-menu")) setContextMenu(null);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [contextMenu]);

  function hitTestNode(point: Point): CanvasNode | null {
    const cards = dataRef.current.nodes.filter((node) => node.type !== "group");
    for (let index = cards.length - 1; index >= 0; index -= 1) {
      if (pointInNode(point, cards[index])) return cards[index];
    }
    const groups = dataRef.current.nodes.filter((node) => node.type === "group");
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      if (pointInNode(point, groups[index])) return groups[index];
    }
    return null;
  }

  function hitTestEdge(point: Point): CanvasEdge | null {
    const threshold = 8 / transformRef.current.k;
    for (let index = dataRef.current.edges.length - 1; index >= 0; index -= 1) {
      const edge = dataRef.current.edges[index];
      const geometry = getEdgeGeometry(edge, dataRef.current.nodes);
      if (geometry && distanceToEdge(point, geometry) <= threshold) return edge;
    }
    return null;
  }

  function hitTestAnchor(point: Point): { node: CanvasNode; side: Side } | null {
    const radius = ANCHOR_RADIUS / transformRef.current.k;
    const candidates = dataRef.current.nodes.filter((node) => selectionRef.current.has(node.id) && node.type !== "group");
    for (const node of candidates) {
      for (const side of SIDES) {
        const anchor = anchorPoint(node, side);
        if (Math.hypot(anchor.x - point.x, anchor.y - point.y) <= radius) return { node, side };
      }
    }
    return null;
  }

  function hitTestHandle(point: Point, node: CanvasNode): string | null {
    const radius = HANDLE_SIZE / transformRef.current.k;
    const corners: Array<[string, number, number]> = [
      ["tl", node.x, node.y],
      ["tr", node.x + node.width, node.y],
      ["bl", node.x, node.y + node.height],
      ["br", node.x + node.width, node.y + node.height],
    ];
    for (const [id, x, y] of corners) {
      if (Math.abs(point.x - x) <= radius && Math.abs(point.y - y) <= radius) return id;
    }
    return null;
  }

  function worldFromClient(clientX: number, clientY: number): Point {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToWorld(transformRef.current, clientX - rect.left, clientY - rect.top);
  }

  function centerPoint(): Point {
    const surface = surfaceRef.current;
    return screenToWorld(transformRef.current, (surface?.clientWidth ?? 800) / 2, (surface?.clientHeight ?? 600) / 2);
  }

  function selectOnlyNode(id: string) {
    setSelection(new Set([id]));
    setSelectedEdges(new Set());
  }

  function startEditing(target: EditTarget) {
    if (readOnly) return;
    if (target.kind === "text") {
      const node = dataRef.current.nodes.find((candidate): candidate is TextNode => candidate.id === target.id && candidate.type === "text");
      if (!node) return;
      setEditDraft(node.text);
    } else if (target.kind === "group") {
      const node = dataRef.current.nodes.find((candidate): candidate is GroupNode => candidate.id === target.id && candidate.type === "group");
      if (!node) return;
      setEditDraft(node.label ?? "");
    } else {
      const edge = dataRef.current.edges.find((candidate) => candidate.id === target.id);
      if (!edge) return;
      setEditDraft(edge.label ?? "");
    }
    editingRef.current = target;
    setEditing(target);
    setContextMenu(null);
  }

  function finishEditing() {
    const target = editingRef.current;
    if (!target) return;
    editingRef.current = null;
    setEditing(null);
    if (readOnly) return;
    if (target.kind === "text") {
      commit({ ...dataRef.current, nodes: dataRef.current.nodes.map((node) => node.id === target.id ? { ...node, text: editDraft } : node) });
    } else if (target.kind === "group") {
      commit({ ...dataRef.current, nodes: dataRef.current.nodes.map((node) => node.id === target.id ? { ...node, label: editDraft } : node) });
    } else {
      commit({ ...dataRef.current, edges: dataRef.current.edges.map((edge) => edge.id === target.id ? { ...edge, label: editDraft || undefined } : edge) });
    }
  }

  function deleteSelection() {
    if (readOnly) return;
    const nodeIds = selectionRef.current;
    const edgeIds = selectedEdgesRef.current;
    if (nodeIds.size === 0 && edgeIds.size === 0) return;
    commit({
      nodes: dataRef.current.nodes.filter((node) => !nodeIds.has(node.id)),
      edges: dataRef.current.edges.filter((edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.fromNode) && !nodeIds.has(edge.toNode)),
    });
    setSelection(new Set());
    setSelectedEdges(new Set());
    setColorPaletteOpen(false);
  }

  function copySelection(): ClipboardData {
    const nodeIds = selectionRef.current;
    const copied = {
      nodes: dataRef.current.nodes.filter((node) => nodeIds.has(node.id)),
      edges: dataRef.current.edges.filter((edge) => nodeIds.has(edge.fromNode) && nodeIds.has(edge.toNode)),
    };
    clipboardRef.current = copied;
    return copied;
  }

  function duplicate(source: ClipboardData, offsetX: number, offsetY = offsetX): { data: CanvasData; nodeIds: Set<string> } | null {
    if (source.nodes.length === 0) return null;
    const idMap = new Map<string, string>();
    const nodes = source.nodes.map((node) => {
      const id = newNodeId();
      idMap.set(node.id, id);
      return { ...node, id, x: node.x + offsetX, y: node.y + offsetY };
    });
    const edges = source.edges.flatMap((edge) => {
      const fromNode = idMap.get(edge.fromNode);
      const toNode = idMap.get(edge.toNode);
      return fromNode && toNode ? [{ ...edge, id: newNodeId(), fromNode, toNode }] : [];
    });
    return {
      data: { nodes: [...dataRef.current.nodes, ...nodes], edges: [...dataRef.current.edges, ...edges] },
      nodeIds: new Set(nodes.map((node) => node.id)),
    };
  }

  function duplicateCurrentSelection(offset = GRID): Set<string> {
    if (readOnly) return new Set();
    const result = duplicate(copySelection(), offset);
    if (!result) return new Set();
    commit(result.data);
    setSelection(result.nodeIds);
    setSelectedEdges(new Set());
    return result.nodeIds;
  }

  function pasteClipboard(point: Point) {
    if (readOnly) return;
    const source = clipboardRef.current;
    const bounds = boundsOf(source.nodes);
    if (!bounds) return;
    let offsetX = point.x - (bounds.x + bounds.width / 2);
    let offsetY = point.y - (bounds.y + bounds.height / 2);
    if (snapToGrid) {
      offsetX = snap(offsetX);
      offsetY = snap(offsetY);
    }
    const result = duplicate(source, offsetX, offsetY);
    if (!result) return;
    commit(result.data);
    setSelection(result.nodeIds);
    setSelectedEdges(new Set());
  }

  function movementIds(clicked: CanvasNode, baseSelection: Set<string>): Set<string> {
    const ids = new Set(baseSelection.has(clicked.id) ? baseSelection : [clicked.id]);
    for (const id of [...ids]) {
      const node = dataRef.current.nodes.find((candidate) => candidate.id === id);
      if (node?.type === "group") {
        for (const child of dataRef.current.nodes) {
          if (nodeInsideGroup(child, node)) ids.add(child.id);
        }
      }
    }
    return ids;
  }

  function bringToFront(nodeId: string): boolean {
    const node = dataRef.current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === "group" || dataRef.current.nodes[dataRef.current.nodes.length - 1]?.id === nodeId) return false;
    const next = { ...dataRef.current, nodes: [...dataRef.current.nodes.filter((candidate) => candidate.id !== nodeId), node] };
    dataRef.current = next;
    setData(next);
    return true;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (parseError || event.button === 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    const point = worldFromClient(event.clientX, event.clientY);
    setContextMenu(null);
    setColorPaletteOpen(false);

    if (spaceHeldRef.current || event.button === 1) {
      modeRef.current = { kind: "panning", startX: event.clientX, startY: event.clientY, origin: transformRef.current };
      canvas.style.cursor = "grabbing";
      return;
    }

    const singleSelected = selectionRef.current.size === 1
      ? dataRef.current.nodes.find((node) => selectionRef.current.has(node.id))
      : null;
    if (singleSelected && !readOnly) {
      const handle = hitTestHandle(point, singleSelected);
      if (handle) {
        modeRef.current = {
          kind: "resizing",
          nodeId: singleSelected.id,
          handle,
          startWorld: point,
          startRect: { x: singleSelected.x, y: singleSelected.y, width: singleSelected.width, height: singleSelected.height },
          changed: false,
        };
        return;
      }
    }

    const anchor = readOnly ? null : hitTestAnchor(point);
    if (anchor) {
      modeRef.current = { kind: "connecting", fromNode: anchor.node.id, fromSide: anchor.side };
      setDraggingEdge({ fromNode: anchor.node.id, fromSide: anchor.side, x: point.x, y: point.y });
      canvas.style.cursor = "crosshair";
      return;
    }

    const hitNode = hitTestNode(point);
    if (hitNode) {
      if (event.shiftKey) {
        const next = new Set(selectionRef.current);
        if (next.has(hitNode.id)) next.delete(hitNode.id);
        else next.add(hitNode.id);
        setSelection(next);
        setSelectedEdges(new Set());
        modeRef.current = { kind: "idle" };
        return;
      }

      if (readOnly) {
        selectOnlyNode(hitNode.id);
        modeRef.current = { kind: "idle" };
        return;
      }

      let baseSelection = selectionRef.current.has(hitNode.id) ? new Set(selectionRef.current) : new Set([hitNode.id]);
      setSelectedEdges(new Set());
      let reordered = false;
      if (event.altKey) {
        const ids = movementIds(hitNode, baseSelection);
        const source = {
          nodes: dataRef.current.nodes.filter((node) => ids.has(node.id)),
          edges: dataRef.current.edges.filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode)),
        };
        const duplicated = duplicate(source, 0);
        if (duplicated) {
          dataRef.current = duplicated.data;
          setData(duplicated.data);
          baseSelection = duplicated.nodeIds;
        }
      } else {
        reordered = bringToFront(hitNode.id);
      }
      setSelection(baseSelection);
      const ids = event.altKey ? baseSelection : movementIds(hitNode, baseSelection);
      const startPositions = new Map<string, Point>();
      for (const id of ids) {
        const node = dataRef.current.nodes.find((candidate) => candidate.id === id);
        if (node) startPositions.set(id, { x: node.x, y: node.y });
      }
      modeRef.current = { kind: "dragging", startWorld: point, startPositions, changed: event.altKey || reordered };
      canvas.style.cursor = "grabbing";
      return;
    }

    const hitEdge = hitTestEdge(point);
    if (hitEdge) {
      if (event.shiftKey) {
        const next = new Set(selectedEdgesRef.current);
        if (next.has(hitEdge.id)) next.delete(hitEdge.id);
        else next.add(hitEdge.id);
        setSelectedEdges(next);
      } else {
        setSelectedEdges(new Set([hitEdge.id]));
      }
      setSelection(new Set());
      modeRef.current = { kind: "idle" };
      return;
    }

    if (!event.shiftKey) {
      setSelection(new Set());
      setSelectedEdges(new Set());
    }
    modeRef.current = { kind: "marquee", startWorld: point, currentWorld: point, additive: event.shiftKey };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mode = modeRef.current;
    if (mode.kind === "panning") {
      setTransform({ x: mode.origin.x + event.clientX - mode.startX, y: mode.origin.y + event.clientY - mode.startY, k: mode.origin.k });
      return;
    }
    const point = worldFromClient(event.clientX, event.clientY);

    if (mode.kind === "marquee") {
      mode.currentWorld = point;
      setMarquee({ x0: mode.startWorld.x, y0: mode.startWorld.y, x1: point.x, y1: point.y });
      return;
    }
    if (mode.kind === "dragging") {
      let rawDx = point.x - mode.startWorld.x;
      let rawDy = point.y - mode.startWorld.y;
      if (event.shiftKey) {
        if (Math.abs(rawDx) >= Math.abs(rawDy)) rawDy = 0;
        else rawDx = 0;
      }
      let dx = rawDx;
      let dy = rawDy;
      if (!spaceHeldRef.current && snapToGrid) {
        dx = snap(dx);
        dy = snap(dy);
      }
      if (!spaceHeldRef.current && snapToObjects) {
        const movingNodes = dataRef.current.nodes.filter((node) => mode.startPositions.has(node.id));
        const startBounds = boundsOf(movingNodes.map((node) => {
          const start = mode.startPositions.get(node.id)!;
          return { ...node, x: start.x, y: start.y };
        }));
        const stationary = dataRef.current.nodes.filter((node) => !mode.startPositions.has(node.id));
        if (startBounds && stationary.length > 0) {
          const stationaryX = stationary.flatMap((node) => alignmentValues(node));
          const stationaryY = stationary.flatMap((node) => verticalAlignmentValues(node));
          const moved = { ...startBounds, x: startBounds.x + rawDx, y: startBounds.y + rawDy };
          const alignX = nearestAlignmentOffset(alignmentValues(moved), stationaryX, 8 / transformRef.current.k);
          const alignY = nearestAlignmentOffset(verticalAlignmentValues(moved), stationaryY, 8 / transformRef.current.k);
          if (alignX !== null) dx = rawDx + alignX;
          if (alignY !== null) dy = rawDy + alignY;
        }
      }
      if (dx === 0 && dy === 0 && !mode.changed) return;
      mode.changed = true;
      const next = {
        ...dataRef.current,
        nodes: dataRef.current.nodes.map((node) => {
          const start = mode.startPositions.get(node.id);
          return start ? { ...node, x: start.x + dx, y: start.y + dy } : node;
        }),
      };
      dataRef.current = next;
      setData(next);
      return;
    }
    if (mode.kind === "resizing") {
      const { startRect, handle } = mode;
      const right = startRect.x + startRect.width;
      const bottom = startRect.y + startRect.height;
      let x = startRect.x;
      let y = startRect.y;
      let width = startRect.width;
      let height = startRect.height;
      let candidateX = !spaceHeldRef.current && snapToGrid ? snap(point.x) : point.x;
      let candidateY = !spaceHeldRef.current && snapToGrid ? snap(point.y) : point.y;
      if (!spaceHeldRef.current && snapToObjects) {
        const stationary = dataRef.current.nodes.filter((node) => node.id !== mode.nodeId);
        const threshold = 8 / transformRef.current.k;
        const stationaryX = stationary.flatMap((node) => alignmentValues(node));
        const stationaryY = stationary.flatMap((node) => verticalAlignmentValues(node));
        const alignX = nearestAlignmentOffset([point.x], stationaryX, threshold);
        const alignY = nearestAlignmentOffset([point.y], stationaryY, threshold);
        if (alignX !== null) candidateX = point.x + alignX;
        if (alignY !== null) candidateY = point.y + alignY;
      }
      if (handle.includes("l")) {
        x = Math.min(candidateX, right - MIN_NODE_WIDTH);
        width = right - x;
      }
      if (handle.includes("r")) width = Math.max(MIN_NODE_WIDTH, candidateX - startRect.x);
      if (handle.includes("t")) {
        y = Math.min(candidateY, bottom - MIN_NODE_HEIGHT);
        height = bottom - y;
      }
      if (handle.includes("b")) height = Math.max(MIN_NODE_HEIGHT, candidateY - startRect.y);
      if (event.shiftKey) {
        const ratio = startRect.width / startRect.height;
        if (Math.abs(width - startRect.width) >= Math.abs(height - startRect.height)) height = width / ratio;
        else width = height * ratio;
        if (handle.includes("l")) x = right - width;
        if (handle.includes("t")) y = bottom - height;
      }
      mode.changed = true;
      const next = {
        ...dataRef.current,
        nodes: dataRef.current.nodes.map((node) => node.id === mode.nodeId ? { ...node, x, y, width, height } : node),
      };
      dataRef.current = next;
      setData(next);
      return;
    }
    if (mode.kind === "connecting") {
      setDraggingEdge({ fromNode: mode.fromNode, fromSide: mode.fromSide, x: point.x, y: point.y });
      return;
    }

    const selectedNode = selectionRef.current.size === 1
      ? dataRef.current.nodes.find((node) => selectionRef.current.has(node.id))
      : null;
    const handle = !readOnly && selectedNode ? hitTestHandle(point, selectedNode) : null;
    if (handle === "tl" || handle === "br") canvas.style.cursor = "nwse-resize";
    else if (handle === "tr" || handle === "bl") canvas.style.cursor = "nesw-resize";
    else if (!readOnly && hitTestAnchor(point)) canvas.style.cursor = "crosshair";
    else if (hitTestNode(point)) canvas.style.cursor = readOnly ? "default" : "grab";
    else if (hitTestEdge(point)) canvas.style.cursor = "pointer";
    else canvas.style.cursor = spaceHeldRef.current ? "grab" : "default";
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const mode = modeRef.current;
    if (mode.kind === "marquee") {
      const x0 = Math.min(mode.startWorld.x, mode.currentWorld.x);
      const x1 = Math.max(mode.startWorld.x, mode.currentWorld.x);
      const y0 = Math.min(mode.startWorld.y, mode.currentWorld.y);
      const y1 = Math.max(mode.startWorld.y, mode.currentWorld.y);
      const within = dataRef.current.nodes.filter((node) => node.x + node.width >= x0 && node.x <= x1 && node.y + node.height >= y0 && node.y <= y1);
      setSelection((previous) => new Set([...(mode.additive ? previous : []), ...within.map((node) => node.id)]));
      setMarquee(null);
    } else if ((mode.kind === "dragging" || mode.kind === "resizing") && mode.changed) {
      commit(dataRef.current);
    } else if (mode.kind === "connecting") {
      const point = worldFromClient(event.clientX, event.clientY);
      const targetAnchor = hitTestAnchor(point);
      const targetNode = targetAnchor?.node ?? hitTestNode(point);
      if (targetNode && targetNode.id !== mode.fromNode && targetNode.type !== "group") {
        const toSide = targetAnchor?.side ?? nearestSide(targetNode, point);
        commit({
          ...dataRef.current,
          edges: [...dataRef.current.edges, {
            id: newNodeId(),
            fromNode: mode.fromNode,
            fromSide: mode.fromSide,
            fromEnd: "none",
            toNode: targetNode.id,
            toSide,
            toEnd: "arrow",
          }],
        });
      } else if (!targetNode) {
        const node: TextNode = {
          id: newNodeId(),
          type: "text",
          x: snapToGrid ? snap(point.x - 120) : point.x - 120,
          y: snapToGrid ? snap(point.y - 50) : point.y - 50,
          width: 240,
          height: 100,
          text: "",
        };
        const edge: CanvasEdge = {
          id: newNodeId(),
          fromNode: mode.fromNode,
          fromSide: mode.fromSide,
          fromEnd: "none",
          toNode: node.id,
          toSide: oppositeSide(mode.fromSide),
          toEnd: "arrow",
        };
        commit({ nodes: [...dataRef.current.nodes, node], edges: [...dataRef.current.edges, edge] });
        selectOnlyNode(node.id);
        startEditing({ kind: "text", id: node.id });
      }
      setDraggingEdge(null);
    }
    modeRef.current = { kind: "idle" };
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (canvas) canvas.style.cursor = "default";
  }

  function onPointerCancel(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const mode = modeRef.current;
    if ((mode.kind === "dragging" || mode.kind === "resizing") && mode.changed) commit(dataRef.current);
    setMarquee(null);
    setDraggingEdge(null);
    modeRef.current = { kind: "idle" };
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (canvas) canvas.style.cursor = "default";
  }

  function onDoubleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (parseError) return;
    const point = worldFromClient(event.clientX, event.clientY);
    const edge = hitTestEdge(point);
    if (edge) {
      setSelection(new Set());
      setSelectedEdges(new Set([edge.id]));
      startEditing({ kind: "edge", id: edge.id });
      return;
    }
    const node = hitTestNode(point);
    if (!node) {
      if (!readOnly) addTextCard(point);
      return;
    }
    selectOnlyNode(node.id);
    if (node.type === "text") {
      if (!readOnly) startEditing({ kind: "text", id: node.id });
    } else if (node.type === "group") {
      if (!readOnly) startEditing({ kind: "group", id: node.id });
    }
    else if (node.type === "file") {
      if (node.file.toLowerCase().endsWith(".md") || isPdfPath(node.file)) void openNote(node.file);
      else if (mediaKindOf(node.file) === "image") setLightboxImageSrc(assetUrlFor(node.file));
    } else if (node.type === "link") {
      void openShell(node.url).catch((error) => console.error("[canvas] failed to open external link:", error));
    }
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const current = transformRef.current;
    const nextScale = Math.min(4, Math.max(0.1, current.k * factor));
    const worldX = (clientX - current.x) / current.k;
    const worldY = (clientY - current.y) / current.k;
    setTransform({ k: nextScale, x: clientX - worldX * nextScale, y: clientY - worldY * nextScale });
  }

  function zoomToActualSize() {
    const surface = surfaceRef.current;
    const current = transformRef.current;
    if (!surface || current.k === 1) return;
    // Keep the world point currently under the viewport centre fixed. Merely
    // replacing `k` while retaining x/y leaves the translation calculated
    // for the old scale and can move every card completely off-screen.
    zoomAt(surface.clientWidth / 2, surface.clientHeight / 2, 1 / current.k);
  }

  function onWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (event.ctrlKey || event.metaKey || spaceHeldRef.current) {
      const factor = Math.exp(-event.deltaY * 0.0025);
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    } else if (event.shiftKey) {
      setTransform((current) => ({ ...current, x: current.x - (event.deltaX || event.deltaY) }));
    } else {
      setTransform((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    }
  }

  function fitBounds(bounds: Rect | null) {
    const surface = surfaceRef.current;
    if (!surface || !bounds) {
      setTransform({ x: 0, y: 0, k: 1 });
      return;
    }
    const padding = 70;
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    const scale = Math.min(2, Math.max(0.1, Math.min((surface.clientWidth - padding * 2) / width, (surface.clientHeight - padding * 2) / height)));
    setTransform({
      k: scale,
      x: surface.clientWidth / 2 - (bounds.x + bounds.width / 2) * scale,
      y: surface.clientHeight / 2 - (bounds.y + bounds.height / 2) * scale,
    });
  }

  function fitAll() {
    fitBounds(boundsOf(dataRef.current.nodes));
  }

  function fitSelection() {
    const nodes = dataRef.current.nodes.filter((node) => selectionRef.current.has(node.id));
    fitBounds(boundsOf(nodes));
  }

  function nudgeSelection(dx: number, dy: number) {
    if (selectionRef.current.size === 0) return;
    commit({
      ...dataRef.current,
      nodes: dataRef.current.nodes.map((node) => selectionRef.current.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node),
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (event.code === "Space") {
      spaceHeldRef.current = true;
      event.currentTarget.style.cursor = "grab";
      event.preventDefault();
    }
    if (editing || parseError) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const mutatingShortcut = event.key === "Delete" || event.key === "Backspace"
      || (mod && ["x", "v", "d", "z", "y"].includes(key))
      || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      || event.key === "Enter";
    if (readOnly && mutatingShortcut) {
      event.preventDefault();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && (selectionRef.current.size > 0 || selectedEdgesRef.current.size > 0)) {
      event.preventDefault();
      deleteSelection();
    } else if (mod && key === "z" && event.shiftKey) {
      event.preventDefault();
      redo();
    } else if (mod && key === "z") {
      event.preventDefault();
      undo();
    } else if (mod && key === "y") {
      event.preventDefault();
      redo();
    } else if (mod && key === "a") {
      event.preventDefault();
      setSelection(new Set(dataRef.current.nodes.map((node) => node.id)));
      setSelectedEdges(new Set());
    } else if (mod && key === "c") {
      event.preventDefault();
      copySelection();
    } else if (mod && key === "x") {
      event.preventDefault();
      copySelection();
      deleteSelection();
    } else if (mod && key === "v") {
      event.preventDefault();
      pasteClipboard(centerPoint());
    } else if (mod && key === "d") {
      event.preventDefault();
      duplicateCurrentSelection();
    } else if (event.shiftKey && event.key === "1") {
      event.preventDefault();
      fitAll();
    } else if (event.shiftKey && event.key === "2") {
      event.preventDefault();
      fitSelection();
    } else if (event.key === "Escape") {
      setSelection(new Set());
      setSelectedEdges(new Set());
      setColorPaletteOpen(false);
    } else if (event.key === "Enter") {
      const node = dataRef.current.nodes.find((candidate) => selectionRef.current.has(candidate.id));
      const edge = dataRef.current.edges.find((candidate) => selectedEdgesRef.current.has(candidate.id));
      if (node?.type === "text") startEditing({ kind: "text", id: node.id });
      else if (node?.type === "group") startEditing({ kind: "group", id: node.id });
      else if (edge) startEditing({ kind: "edge", id: edge.id });
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const amount = event.shiftKey ? GRID : 1;
      nudgeSelection(event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0, event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0);
    }
  }

  function onKeyUp(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (event.code === "Space") {
      spaceHeldRef.current = false;
      event.currentTarget.style.cursor = "default";
    }
  }

  useEffect(() => {
    const releaseSpace = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeldRef.current = false;
    };
    const releaseOnBlur = () => {
      spaceHeldRef.current = false;
      if (canvasRef.current) canvasRef.current.style.cursor = "default";
    };
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", releaseOnBlur);
    return () => {
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", releaseOnBlur);
    };
  }, []);

  useEffect(() => () => {
    void flush(path);
  }, [flush, path]);

  function addTextCard(point = insertPointRef.current ?? centerPoint()) {
    if (readOnly) return;
    const node: TextNode = {
      id: newNodeId(),
      type: "text",
      x: snapToGrid ? snap(point.x - 125) : point.x - 125,
      y: snapToGrid ? snap(point.y - 60) : point.y - 60,
      width: 250,
      height: 120,
      text: "",
    };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    selectOnlyNode(node.id);
    startEditing({ kind: "text", id: node.id });
    insertPointRef.current = null;
  }

  function openFilePicker(kind: CanvasFilePickerKind, point = centerPoint()) {
    if (readOnly) return;
    insertPointRef.current = point;
    setFilePickerKind(kind);
    setContextMenu(null);
  }

  function addFileCard(filePath: string, point = insertPointRef.current ?? centerPoint()) {
    if (readOnly) return;
    setFilePickerKind(null);
    const kind = mediaKindOf(filePath);
    const size = kind === "image" ? { width: 320, height: 240 } : { width: 300, height: 200 };
    const node: CanvasNode = {
      id: newNodeId(),
      type: "file",
      x: snapToGrid ? snap(point.x - size.width / 2) : point.x - size.width / 2,
      y: snapToGrid ? snap(point.y - size.height / 2) : point.y - size.height / 2,
      ...size,
      file: filePath,
    };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    selectOnlyNode(node.id);
    insertPointRef.current = null;
  }

  function openLinkDialog(point = centerPoint()) {
    if (readOnly) return;
    setLinkDialog({ point, value: "" });
    setContextMenu(null);
  }

  function submitLink() {
    if (!linkDialog || readOnly) return;
    const url = normalizeUrl(linkDialog.value);
    if (!url) return;
    const node: CanvasNode = {
      id: newNodeId(),
      type: "link",
      x: snapToGrid ? snap(linkDialog.point.x - 140) : linkDialog.point.x - 140,
      y: snapToGrid ? snap(linkDialog.point.y - 70) : linkDialog.point.y - 70,
      width: 280,
      height: 140,
      url,
    };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    selectOnlyNode(node.id);
    setLinkDialog(null);
  }

  function addGroup(point = centerPoint()) {
    if (readOnly) return;
    const selected = dataRef.current.nodes.filter((node) => selectionRef.current.has(node.id) && node.type !== "group");
    const bounds = boundsOf(selected) ?? { x: point.x - 180, y: point.y - 120, width: 360, height: 240 };
    const padding = 30;
    const node: GroupNode = {
      id: newNodeId(),
      type: "group",
      x: snapToGrid ? snap(bounds.x - padding) : bounds.x - padding,
      y: snapToGrid ? snap(bounds.y - padding) : bounds.y - padding,
      width: snapToGrid ? snap(bounds.width + padding * 2) : bounds.width + padding * 2,
      height: snapToGrid ? snap(bounds.height + padding * 2) : bounds.height + padding * 2,
      label: t("canvas.newGroupLabel"),
    };
    commit({ ...dataRef.current, nodes: [node, ...dataRef.current.nodes] });
    selectOnlyNode(node.id);
    setContextMenu(null);
  }

  function applyColor(color: string | null) {
    if (readOnly) return;
    const nodeIds = selectionRef.current;
    const edgeIds = selectedEdgesRef.current;
    commit({
      nodes: dataRef.current.nodes.map((node) => nodeIds.has(node.id) ? (color ? { ...node, color } : withoutColor(node)) : node),
      edges: dataRef.current.edges.map((edge) => edgeIds.has(edge.id) ? (color ? { ...edge, color } : withoutColor(edge)) : edge),
    });
    setColorPaletteOpen(false);
  }

  function onContextMenu(event: React.MouseEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const point = worldFromClient(event.clientX, event.clientY);
    const node = hitTestNode(point);
    const edge = node ? null : hitTestEdge(point);
    if (node && !selectionRef.current.has(node.id)) selectOnlyNode(node.id);
    if (edge && !selectedEdgesRef.current.has(edge.id)) {
      setSelection(new Set());
      setSelectedEdges(new Set([edge.id]));
    }
    if (!node && !edge) {
      setSelection(new Set());
      setSelectedEdges(new Set());
    }
    setContextMenu({ x: event.clientX, y: event.clientY, world: point, nodeId: node?.id ?? null, edgeId: edge?.id ?? null });
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (parseError || readOnly) return;
    const point = worldFromClient(event.clientX, event.clientY);
    const vaultPath = event.dataTransfer.getData("text/nodus-path");
    if (vaultPath && allFilePaths.has(vaultPath)) {
      addFileCard(vaultPath, point);
      return;
    }
    const uri = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (/^https?:\/\//i.test(uri.trim())) {
      setLinkDialog({ point, value: uri.trim() });
    }
  }

  const selectedNodes = useMemo(() => data.nodes.filter((node) => selection.has(node.id)), [data.nodes, selection]);
  const selectionBounds = useMemo(() => boundsOf(selectedNodes), [selectedNodes]);
  const selectedEdge = useMemo(() => data.edges.find((edge) => selectedEdges.has(edge.id)) ?? null, [data.edges, selectedEdges]);
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const toolbarPosition = useMemo(() => {
    const surfaceWidth = surfaceRef.current?.clientWidth ?? 0;
    const clampX = (value: number) => Math.min(Math.max(value, 110), Math.max(110, surfaceWidth - 110));
    if (selectionBounds) {
      const top = selectionBounds.y * transform.k + transform.y - 10;
      const below = top < 48;
      return {
        x: clampX((selectionBounds.x + selectionBounds.width / 2) * transform.k + transform.x),
        y: below ? (selectionBounds.y + selectionBounds.height) * transform.k + transform.y + 10 : top,
        below,
      };
    }
    if (selectedEdge) {
      const geometry = getEdgeGeometry(selectedEdge, data.nodes);
      if (geometry) {
        const point = pointOnBezier(geometry, 0.5);
        const top = point.y * transform.k + transform.y - 10;
        const below = top < 48;
        return {
          x: clampX(point.x * transform.k + transform.x),
          y: below ? point.y * transform.k + transform.y + 10 : top,
          below,
        };
      }
    }
    return null;
  }, [data.nodes, selectedEdge, selectionBounds, transform]);

  const editingNode = editing?.kind === "text" || editing?.kind === "group"
    ? data.nodes.find((node) => node.id === editing.id) ?? null
    : null;
  const editingEdge = editing?.kind === "edge" ? data.edges.find((edge) => edge.id === editing.id) ?? null : null;
  const edgeEditorPoint = editingEdge ? (() => {
    const geometry = getEdgeGeometry(editingEdge, data.nodes);
    return geometry ? pointOnBezier(geometry, 0.5) : null;
  })() : null;

  return (
    <div className="canvas-tab">
      <div
        className="canvas-surface"
        ref={surfaceRef}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <canvas
          ref={canvasRef}
          className="canvas-2d"
          tabIndex={0}
          aria-label={t("canvas.surface")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onContextMenu={onContextMenu}
        />

        {!parseError && data.nodes.length === 0 && (
          <div className="canvas-empty-hint">
            <StickyNote size={26} strokeWidth={1.5} />
            <span>{t("canvas.emptyHint")}</span>
          </div>
        )}

        {parseError && (
          <div className="canvas-error" role="alert">
            <strong>{t("canvas.parseError")}</strong>
            <span>{parseError}</span>
          </div>
        )}

        <div ref={addToolbarRef} className="canvas-add-toolbar" role="toolbar" aria-label={t("canvas.addToolbar")}>
          <Tooltip label={t("canvas.addText")} placement="top">
            <button type="button" aria-label={t("canvas.addText")} disabled={!!parseError || readOnly} onClick={() => addTextCard()}><StickyNote size={18} /></button>
          </Tooltip>
          <Tooltip label={t("canvas.addFile")} placement="top">
            <button type="button" aria-label={t("canvas.addFile")} disabled={!!parseError || readOnly} onClick={() => openFilePicker("note")}><FilePlus2 size={18} /></button>
          </Tooltip>
          <Tooltip label={t("canvas.addMedia")} placement="top">
            <button type="button" aria-label={t("canvas.addMedia")} disabled={!!parseError || readOnly} onClick={() => openFilePicker("media")}><ImagePlus size={18} /></button>
          </Tooltip>
          <Tooltip label={t("canvas.addLink")} placement="top">
            <button type="button" aria-label={t("canvas.addLink")} disabled={!!parseError || readOnly} onClick={() => openLinkDialog()}><ExternalLink size={18} /></button>
          </Tooltip>
          <Tooltip label={t("canvas.addGroup")} placement="top">
            <button type="button" aria-label={t("canvas.addGroup")} disabled={!!parseError || readOnly} onClick={() => addGroup()}><Boxes size={18} /></button>
          </Tooltip>
          <div className="canvas-toolbar-divider" />
          <Tooltip label={t("canvas.undo")} placement="top">
            <button type="button" aria-label={t("canvas.undo")} disabled={readOnly || historyIndexRef.current <= 0} onClick={undo}><Undo2 size={18} /></button>
          </Tooltip>
          <Tooltip label={t("canvas.redo")} placement="top">
            <button type="button" aria-label={t("canvas.redo")} disabled={readOnly || historyIndexRef.current >= historyRef.current.length - 1} onClick={redo}><Redo2 size={18} /></button>
          </Tooltip>
        </div>

        <div className="canvas-zoom" role="toolbar" aria-label={t("canvas.zoomToolbar")}>
          <Tooltip label={t("canvas.zoomOut")} placement="bottom">
            <button type="button" aria-label={t("canvas.zoomOut")} onClick={() => zoomAt((surfaceRef.current?.clientWidth ?? 0) / 2, (surfaceRef.current?.clientHeight ?? 0) / 2, 0.8)}><Minus size={16} /></button>
          </Tooltip>
          <button type="button" className="canvas-zoom-value" aria-label={t("canvas.actualSize")} onClick={zoomToActualSize}>{Math.round(transform.k * 100)}%</button>
          <Tooltip label={t("canvas.zoomIn")} placement="bottom">
            <button type="button" aria-label={t("canvas.zoomIn")} onClick={() => zoomAt((surfaceRef.current?.clientWidth ?? 0) / 2, (surfaceRef.current?.clientHeight ?? 0) / 2, 1.25)}><Plus size={16} /></button>
          </Tooltip>
          <Tooltip label={t("canvas.zoomToFit")} placement="bottom">
            <button type="button" aria-label={t("canvas.zoomToFit")} onClick={fitAll}><Maximize size={16} /></button>
          </Tooltip>
          <Tooltip label={t("canvas.resetZoom")} placement="bottom">
            <button type="button" aria-label={t("canvas.resetZoom")} onClick={() => setTransform({ x: 0, y: 0, k: 1 })}><RotateCcw size={16} /></button>
          </Tooltip>
        </div>

        {toolbarPosition && !editing && !readOnly && (
          <div className={`canvas-selection-toolbar${toolbarPosition.below ? " below" : ""}`} style={{ left: toolbarPosition.x, top: toolbarPosition.y }}>
            {(selectedNode?.type === "text" || selectedNode?.type === "group" || selectedEdge) && (
              <Tooltip label={t("canvas.editLabel")} placement="top">
                <button
                  type="button"
                  aria-label={t("canvas.editLabel")}
                  onClick={() => selectedNode?.type === "text"
                    ? startEditing({ kind: "text", id: selectedNode.id })
                    : selectedNode?.type === "group"
                      ? startEditing({ kind: "group", id: selectedNode.id })
                      : selectedEdge && startEditing({ kind: "edge", id: selectedEdge.id })}
                ><Pencil size={16} /></button>
              </Tooltip>
            )}
            <div className="canvas-color-wrap">
              <Tooltip label={t("canvas.setColor")} placement="top">
                <button type="button" aria-label={t("canvas.setColor")} onClick={() => setColorPaletteOpen((open) => !open)}><Palette size={16} /></button>
              </Tooltip>
              {colorPaletteOpen && (
                <div className="canvas-color-palette">
                  {COLOR_CODES.map((color) => (
                    <button
                      key={color ?? "default"}
                      type="button"
                      className={`canvas-color-swatch canvas-color-${color ?? "default"}`}
                      aria-label={t(color ? `canvas.color${color}` : "canvas.defaultColor")}
                      onClick={() => applyColor(color)}
                    />
                  ))}
                </div>
              )}
            </div>
            {selection.size > 0 && (
              <Tooltip label={t("canvas.duplicate")} placement="top">
                <button type="button" aria-label={t("canvas.duplicate")} onClick={() => duplicateCurrentSelection()}><Copy size={16} /></button>
              </Tooltip>
            )}
            {selection.size > 0 && (
              <Tooltip label={t("canvas.groupSelected")} placement="top">
                <button type="button" aria-label={t("canvas.groupSelected")} onClick={() => addGroup()}><Boxes size={16} /></button>
              </Tooltip>
            )}
            <Tooltip label={t("canvas.delete")} placement="top">
              <button type="button" aria-label={t("canvas.delete")} className="canvas-delete-button" onClick={deleteSelection}><Trash2 size={16} /></button>
            </Tooltip>
          </div>
        )}

        {editingNode?.type === "text" && (
          <textarea
            className="canvas-text-editor"
            style={{
              left: editingNode.x * transform.k + transform.x,
              top: editingNode.y * transform.k + transform.y,
              width: editingNode.width * transform.k,
              height: editingNode.height * transform.k,
              fontSize: `${Math.max(10, 13 * transform.k)}px`,
            }}
            value={editDraft}
            autoFocus
            onChange={(event) => setEditDraft(event.target.value)}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
                event.preventDefault();
                finishEditing();
              }
            }}
          />
        )}

        {editingNode?.type === "group" && (
          <input
            className="canvas-label-editor"
            style={{ left: editingNode.x * transform.k + transform.x, top: editingNode.y * transform.k + transform.y - 34 }}
            value={editDraft}
            autoFocus
            onChange={(event) => setEditDraft(event.target.value)}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                finishEditing();
              }
            }}
          />
        )}

        {edgeEditorPoint && (
          <input
            className="canvas-label-editor canvas-edge-label-editor"
            style={{ left: edgeEditorPoint.x * transform.k + transform.x, top: edgeEditorPoint.y * transform.k + transform.y }}
            value={editDraft}
            autoFocus
            placeholder={t("canvas.edgeLabelPlaceholder")}
            onChange={(event) => setEditDraft(event.target.value)}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                finishEditing();
              }
            }}
          />
        )}
      </div>

      {contextMenu && createPortal(
        <div
          className="canvas-context-menu"
          style={{
            left: Math.min(Math.max(8, contextMenu.x), window.innerWidth - 292),
            top: Math.min(Math.max(8, contextMenu.y), window.innerHeight - 356),
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {!contextMenu.nodeId && !contextMenu.edgeId && (
            <>
              <button type="button" disabled={readOnly} onClick={() => { setContextMenu(null); addTextCard(contextMenu.world); }}><StickyNote size={16} />{t("canvas.addText")}</button>
              <button type="button" disabled={readOnly} onClick={() => openFilePicker("note", contextMenu.world)}><FilePlus2 size={16} />{t("canvas.addFile")}</button>
              <button type="button" disabled={readOnly} onClick={() => openFilePicker("media", contextMenu.world)}><ImagePlus size={16} />{t("canvas.addMedia")}</button>
              <button type="button" disabled={readOnly} onClick={() => openLinkDialog(contextMenu.world)}><ExternalLink size={16} />{t("canvas.addLink")}</button>
              <button type="button" disabled={readOnly} onClick={() => addGroup(contextMenu.world)}><Boxes size={16} />{t("canvas.addGroup")}</button>
              <div className="canvas-context-separator" />
              <button
                type="button"
                disabled={readOnly || clipboardRef.current.nodes.length === 0}
                onClick={() => { pasteClipboard(contextMenu.world); setContextMenu(null); }}
              ><ClipboardPaste size={16} />{t("canvas.paste")}</button>
            </>
          )}
          {(contextMenu.nodeId || contextMenu.edgeId) && (
            <>
              {(selectedNode?.type === "text" || selectedNode?.type === "group" || selectedEdge) && (
                <button type="button" disabled={readOnly} onClick={() => selectedNode?.type === "text"
                  ? startEditing({ kind: "text", id: selectedNode.id })
                  : selectedNode?.type === "group"
                    ? startEditing({ kind: "group", id: selectedNode.id })
                    : selectedEdge && startEditing({ kind: "edge", id: selectedEdge.id })}
                ><Pencil size={16} />{t("canvas.editLabel")}</button>
              )}
              {selection.size > 0 && <button type="button" disabled={readOnly} onClick={() => { duplicateCurrentSelection(); setContextMenu(null); }}><Copy size={16} />{t("canvas.duplicate")}</button>}
              {selection.size > 0 && <button type="button" disabled={readOnly} onClick={() => addGroup()}><Boxes size={16} />{t("canvas.groupSelected")}</button>}
              <div className="canvas-context-separator" />
              <button type="button" disabled={readOnly} className="danger" onClick={() => { deleteSelection(); setContextMenu(null); }}><Trash2 size={16} />{t("canvas.delete")}</button>
              <div className="canvas-context-separator" />
              <button type="button" onClick={() => { fitAll(); setContextMenu(null); }}><Maximize size={16} />{t("canvas.zoomToFit")}</button>
              {selection.size > 0 && <button type="button" onClick={() => { fitSelection(); setContextMenu(null); }}><Maximize size={16} />{t("canvas.zoomSelection")}</button>}
            </>
          )}
          <div className="canvas-context-separator" />
          <button type="button" className="canvas-context-toggle" aria-pressed={snapToGrid} onClick={() => setSnapToGrid((value) => !value)}>
            <Grid3X3 size={16} /><span>{t("canvas.snapToGrid")}</span>{snapToGrid && <Check className="canvas-context-check" size={16} />}
          </button>
          <button type="button" className="canvas-context-toggle" aria-pressed={snapToObjects} onClick={() => setSnapToObjects((value) => !value)}>
            <Magnet size={16} /><span>{t("canvas.snapToObjects")}</span>{snapToObjects && <Check className="canvas-context-check" size={16} />}
          </button>
          <button type="button" className="canvas-context-toggle" aria-pressed={readOnly} onClick={() => { setReadOnly((value) => !value); setColorPaletteOpen(false); }}>
            <Lock size={16} /><span>{t("canvas.readOnly")}</span>{readOnly && <Check className="canvas-context-check" size={16} />}
          </button>
        </div>,
        document.body,
      )}

      {filePickerKind && <FilePickerDialog kind={filePickerKind} onPick={addFileCard} onClose={() => { setFilePickerKind(null); insertPointRef.current = null; }} />}
      {linkDialog && (
        <CanvasLinkDialog
          state={linkDialog}
          onChange={(value) => setLinkDialog((current) => current ? { ...current, value } : null)}
          onSubmit={submitLink}
          onClose={() => setLinkDialog(null)}
        />
      )}
    </div>
  );
}

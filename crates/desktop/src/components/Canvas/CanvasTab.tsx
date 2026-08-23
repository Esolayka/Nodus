import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { assetUrlFor } from "../../lib/assetUrl";
import { isPdfPath, mediaKindOf } from "../../lib/attachments";
import {
  emptyCanvas,
  newNodeId,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
  type CanvasNode,
  type Side,
  type TextNode,
} from "../../lib/canvasTypes";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { FilePickerDialog } from "./FilePickerDialog";
import { anchorPoint, render, screenToWorld, type NodePreview, type Transform } from "./canvasRender";
import "./CanvasTab.css";

const GRID = 20;
const HANDLE_SIZE = 9;
const ANCHOR_RADIUS = 10;
const SIDES: Side[] = ["top", "right", "bottom", "left"];

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: get("--bg-secondary", "#161616"),
    grid: "rgba(127,127,127,0.25)",
    cardBg: get("--bg-primary", "#1e1e1e"),
    cardBorder: get("--border", "rgba(255,255,255,0.12)"),
    text: get("--text-normal", "#dadada"),
    textMuted: get("--text-muted", "#a3a3a3"),
    accent: get("--accent", "#7f6df2"),
    groupBg: "rgba(127,127,127,0.06)",
    groupBorder: "rgba(127,127,127,0.25)",
  };
}

function boundsOf(nodes: CanvasNode[]): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null;
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.width));
  const y1 = Math.max(...nodes.map((n) => n.y + n.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

type Mode =
  | { kind: "idle" }
  | { kind: "panning"; startX: number; startY: number; origin: Transform }
  | { kind: "marquee"; startWorld: { x: number; y: number } }
  | { kind: "dragging"; startWorld: { x: number; y: number }; startPositions: Map<string, { x: number; y: number }> }
  | { kind: "resizing"; nodeId: string; handle: string; startWorld: { x: number; y: number }; startRect: { x: number; y: number; width: number; height: number } }
  | { kind: "connecting"; fromNode: string; fromSide: Side };

export function CanvasTab({ path }: { path: string }) {
  const { t } = useTranslation();
  const buffer = useWorkspaceStore((s) => s.buffers[path]);
  const updateContent = useWorkspaceStore((s) => s.updateContent);
  const flush = useWorkspaceStore((s) => s.flush);
  const openNote = useWorkspaceStore((s) => s.openNote);
  const setLightboxImageSrc = useUiStore((s) => s.setLightboxImageSrc);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<CanvasData>(emptyCanvas());
  const dataRef = useRef(data);
  dataRef.current = data;
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draggingEdge, setDraggingEdge] = useState<{ fromNode: string; fromSide: Side; x: number; y: number } | null>(null);

  const modeRef = useRef<Mode>({ kind: "idle" });
  const previewsRef = useRef<Map<string, NodePreview>>(new Map());
  const requestedPreviews = useRef<Set<string>>(new Set());
  const historyRef = useRef<CanvasData[]>([]);
  const historyIndexRef = useRef(-1);
  const loadedPathRef = useRef<string | null>(null);
  const spaceHeldRef = useRef(false);
  const clipboardRef = useRef<CanvasNode[]>([]);

  // Load (or re-load, if this tab switched to a different .canvas file).
  useEffect(() => {
    if (loadedPathRef.current === path) return;
    loadedPathRef.current = path;
    const parsed = parseCanvas(buffer?.content ?? "");
    setData(parsed);
    setSelection(new Set());
    historyRef.current = [parsed];
    historyIndexRef.current = 0;
    previewsRef.current = new Map();
    requestedPreviews.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, buffer?.content]);

  function commit(next: CanvasData) {
    setData(next);
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(next);
    if (historyRef.current.length > 100) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    updateContent(path, serializeCanvas(next));
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    setData(snapshot);
    updateContent(path, serializeCanvas(snapshot));
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    setData(snapshot);
    updateContent(path, serializeCanvas(snapshot));
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    render(canvas, {
      data: dataRef.current,
      transform: transformRef.current,
      selection: selectionRef.current,
      draggingEdge,
      marquee,
      previews: previewsRef.current,
      colors: themeColors(),
    });
  }

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, transform, selection, draggingEdge, marquee]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve previews for file-type nodes lazily.
  useEffect(() => {
    for (const node of data.nodes) {
      if (node.type !== "file" || requestedPreviews.current.has(node.id)) continue;
      requestedPreviews.current.add(node.id);
      const kind = mediaKindOf(node.file);
      if (kind === "image") {
        const img = new Image();
        img.onload = () => {
          previewsRef.current.set(node.id, { kind: "image", img });
          redraw();
        };
        img.src = assetUrlFor(node.file);
      } else if (node.file.toLowerCase().endsWith(".md")) {
        api
          .readNote(node.file)
          .then((content) => {
            const lines = content.split("\n").slice(0, 40);
            previewsRef.current.set(node.id, { kind: "text", lines });
            redraw();
          })
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.nodes]);

  function hitTestNode(worldX: number, worldY: number): CanvasNode | null {
    const cards = dataRef.current.nodes.filter((n) => n.type !== "group");
    for (let i = cards.length - 1; i >= 0; i--) {
      const n = cards[i];
      if (worldX >= n.x && worldX <= n.x + n.width && worldY >= n.y && worldY <= n.y + n.height) return n;
    }
    const groups = dataRef.current.nodes.filter((n) => n.type === "group");
    for (let i = groups.length - 1; i >= 0; i--) {
      const n = groups[i];
      if (worldX >= n.x && worldX <= n.x + n.width && worldY >= n.y && worldY <= n.y + n.height) return n;
    }
    return null;
  }

  function hitTestAnchor(worldX: number, worldY: number): { node: CanvasNode; side: Side } | null {
    const r = ANCHOR_RADIUS / transformRef.current.k;
    for (const node of dataRef.current.nodes) {
      if (node.type === "group") continue;
      for (const side of SIDES) {
        const p = anchorPoint(node, side);
        if (Math.hypot(p.x - worldX, p.y - worldY) <= r) return { node, side };
      }
    }
    return null;
  }

  function hitTestHandle(worldX: number, worldY: number, node: CanvasNode): string | null {
    const r = HANDLE_SIZE / transformRef.current.k;
    const corners: [string, number, number][] = [
      ["tl", node.x, node.y],
      ["tr", node.x + node.width, node.y],
      ["bl", node.x, node.y + node.height],
      ["br", node.x + node.width, node.y + node.height],
    ];
    for (const [id, cx, cy] of corners) {
      if (Math.abs(worldX - cx) <= r && Math.abs(worldY - cy) <= r) return id;
    }
    return null;
  }

  function nodesToMove(): string[] {
    return selectionRef.current.size > 0 ? [...selectionRef.current] : [];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(transformRef.current, sx, sy);

    if (spaceHeldRef.current || e.button === 1) {
      modeRef.current = { kind: "panning", startX: e.clientX, startY: e.clientY, origin: transformRef.current };
      return;
    }

    const singleSelected =
      selectionRef.current.size === 1 ? dataRef.current.nodes.find((n) => selectionRef.current.has(n.id)) : null;
    if (singleSelected) {
      const handle = hitTestHandle(world.x, world.y, singleSelected);
      if (handle) {
        modeRef.current = {
          kind: "resizing",
          nodeId: singleSelected.id,
          handle,
          startWorld: world,
          startRect: { x: singleSelected.x, y: singleSelected.y, width: singleSelected.width, height: singleSelected.height },
        };
        return;
      }
    }

    const anchor = hitTestAnchor(world.x, world.y);
    if (anchor && anchor.node.type !== "group") {
      modeRef.current = { kind: "connecting", fromNode: anchor.node.id, fromSide: anchor.side };
      setDraggingEdge({ fromNode: anchor.node.id, fromSide: anchor.side, x: world.x, y: world.y });
      return;
    }

    const hitNode = hitTestNode(world.x, world.y);
    if (hitNode) {
      if (e.shiftKey) {
        setSelection((prev) => {
          const next = new Set(prev);
          if (next.has(hitNode.id)) next.delete(hitNode.id);
          else next.add(hitNode.id);
          return next;
        });
      } else if (!selectionRef.current.has(hitNode.id)) {
        setSelection(new Set([hitNode.id]));
      }
      const moveIds = e.shiftKey ? nodesToMove() : selectionRef.current.has(hitNode.id) ? nodesToMove() : [hitNode.id];
      const startPositions = new Map<string, { x: number; y: number }>();
      const ids = moveIds.length > 0 ? moveIds : [hitNode.id];
      for (const id of ids) {
        const n = dataRef.current.nodes.find((nn) => nn.id === id);
        if (n) startPositions.set(id, { x: n.x, y: n.y });
      }
      modeRef.current = { kind: "dragging", startWorld: world, startPositions };
      return;
    }

    if (!e.shiftKey) setSelection(new Set());
    modeRef.current = { kind: "marquee", startWorld: world };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const mode = modeRef.current;

    if (mode.kind === "panning") {
      setTransform({ x: mode.origin.x + (e.clientX - mode.startX), y: mode.origin.y + (e.clientY - mode.startY), k: mode.origin.k });
      return;
    }
    const world = screenToWorld(transformRef.current, sx, sy);

    if (mode.kind === "marquee") {
      setMarquee({ x0: mode.startWorld.x, y0: mode.startWorld.y, x1: world.x, y1: world.y });
      return;
    }
    if (mode.kind === "dragging") {
      const dx = snap(world.x - mode.startWorld.x);
      const dy = snap(world.y - mode.startWorld.y);
      const next: CanvasData = {
        ...dataRef.current,
        nodes: dataRef.current.nodes.map((n) => {
          const start = mode.startPositions.get(n.id);
          return start ? { ...n, x: start.x + dx, y: start.y + dy } : n;
        }),
      };
      dataRef.current = next;
      setData(next);
      return;
    }
    if (mode.kind === "resizing") {
      const { handle, startRect } = mode;
      let { x, y, width, height } = startRect;
      const dx = world.x - mode.startWorld.x;
      const dy = world.y - mode.startWorld.y;
      if (handle.includes("l")) {
        x = snap(startRect.x + dx);
        width = snap(startRect.width - dx + (startRect.x - x));
      }
      if (handle.includes("r")) width = snap(startRect.width + dx);
      if (handle.includes("t")) {
        y = snap(startRect.y + dy);
        height = snap(startRect.height - dy + (startRect.y - y));
      }
      if (handle.includes("b")) height = snap(startRect.height + dy);
      width = Math.max(GRID * 2, width);
      height = Math.max(GRID * 2, height);
      const next: CanvasData = {
        ...dataRef.current,
        nodes: dataRef.current.nodes.map((n) => (n.id === mode.nodeId ? { ...n, x, y, width, height } : n)),
      };
      dataRef.current = next;
      setData(next);
      return;
    }
    if (mode.kind === "connecting") {
      setDraggingEdge({ fromNode: mode.fromNode, fromSide: mode.fromSide, x: world.x, y: world.y });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const mode = modeRef.current;
    if (mode.kind === "marquee") {
      const m = marquee;
      setMarquee(null);
      if (m) {
        const x0 = Math.min(m.x0, m.x1);
        const x1 = Math.max(m.x0, m.x1);
        const y0 = Math.min(m.y0, m.y1);
        const y1 = Math.max(m.y0, m.y1);
        const within = dataRef.current.nodes.filter((n) => n.x >= x0 && n.x + n.width <= x1 && n.y >= y0 && n.y + n.height <= y1);
        if (within.length > 0) setSelection((prev) => new Set([...prev, ...within.map((n) => n.id)]));
      }
    } else if (mode.kind === "dragging" || mode.kind === "resizing") {
      commit(dataRef.current);
    } else if (mode.kind === "connecting") {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const world = screenToWorld(transformRef.current, e.clientX - rect.left, e.clientY - rect.top);
        const target = hitTestAnchor(world.x, world.y) ?? { node: hitTestNode(world.x, world.y), side: "left" as Side };
        if (target.node && target.node.id !== mode.fromNode && target.node.type !== "group") {
          commit({
            ...dataRef.current,
            edges: [
              ...dataRef.current.edges,
              { id: newNodeId(), fromNode: mode.fromNode, fromSide: mode.fromSide, toNode: target.node.id, toSide: target.side },
            ],
          });
        }
      }
      setDraggingEdge(null);
    }
    modeRef.current = { kind: "idle" };
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(transformRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTestNode(world.x, world.y);
    if (!hit) {
      const node: CanvasNode = { id: newNodeId(), type: "text", x: snap(world.x - 125), y: snap(world.y - 50), width: 250, height: 100, text: "" };
      commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
      setSelection(new Set([node.id]));
      setEditingNodeId(node.id);
      return;
    }
    if (hit.type === "text") {
      setEditingNodeId(hit.id);
    } else if (hit.type === "file") {
      if (hit.file.toLowerCase().endsWith(".md")) void openNote(hit.file);
      else if (mediaKindOf(hit.file) === "image") setLightboxImageSrc(assetUrlFor(hit.file));
      else if (isPdfPath(hit.file)) void openNote(hit.file);
    } else if (hit.type === "link") {
      window.open(hit.url, "_blank");
    }
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (e.ctrlKey) {
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.01);
      const t = transformRef.current;
      const newK = Math.min(4, Math.max(0.1, t.k * factor));
      const worldX = (mx - t.x) / t.k;
      const worldY = (my - t.y) / t.k;
      setTransform({ k: newK, x: mx - worldX * newK, y: my - worldY * newK });
    } else {
      setTransform((t) => ({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }));
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space") spaceHeldRef.current = true;
      const isMod = e.ctrlKey || e.metaKey;
      if (editingNodeId) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectionRef.current.size > 0) {
        e.preventDefault();
        const ids = selectionRef.current;
        commit({
          nodes: dataRef.current.nodes.filter((n) => !ids.has(n.id)),
          edges: dataRef.current.edges.filter((ed) => !ids.has(ed.fromNode) && !ids.has(ed.toNode)),
        });
        setSelection(new Set());
      } else if (isMod && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (isMod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (isMod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (isMod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(new Set(dataRef.current.nodes.map((n) => n.id)));
      } else if (isMod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
        clipboardRef.current = dataRef.current.nodes.filter((n) => selectionRef.current.has(n.id));
        if (e.key.toLowerCase() === "x" && clipboardRef.current.length > 0) {
          const ids = selectionRef.current;
          commit({
            nodes: dataRef.current.nodes.filter((n) => !ids.has(n.id)),
            edges: dataRef.current.edges.filter((ed) => !ids.has(ed.fromNode) && !ids.has(ed.toNode)),
          });
          setSelection(new Set());
        }
      } else if (isMod && (e.key.toLowerCase() === "v" || e.key.toLowerCase() === "d")) {
        e.preventDefault();
        const source = e.key.toLowerCase() === "d" ? dataRef.current.nodes.filter((n) => selectionRef.current.has(n.id)) : clipboardRef.current;
        if (source.length === 0) return;
        const idMap = new Map<string, string>();
        const copies = source.map((n) => {
          const id = newNodeId();
          idMap.set(n.id, id);
          return { ...n, id, x: n.x + GRID, y: n.y + GRID };
        });
        commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, ...copies] });
        setSelection(new Set(copies.map((c) => c.id)));
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") spaceHeldRef.current = false;
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNodeId]);

  // Flush on unmount so navigating away doesn't lose the last debounced edit.
  useEffect(() => {
    return () => {
      void flush(path);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  function addTextCard() {
    const center = screenToWorld(transformRef.current, (containerRef.current?.clientWidth ?? 800) / 2, (containerRef.current?.clientHeight ?? 600) / 2);
    const node: CanvasNode = { id: newNodeId(), type: "text", x: snap(center.x - 125), y: snap(center.y - 50), width: 250, height: 100, text: "" };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    setSelection(new Set([node.id]));
    setEditingNodeId(node.id);
  }

  function addFileCard(filePath: string) {
    setFilePickerOpen(false);
    const center = screenToWorld(transformRef.current, (containerRef.current?.clientWidth ?? 800) / 2, (containerRef.current?.clientHeight ?? 600) / 2);
    const kind = mediaKindOf(filePath);
    const size = kind === "image" ? { width: 320, height: 240 } : { width: 280, height: 180 };
    const node: CanvasNode = { id: newNodeId(), type: "file", x: snap(center.x - size.width / 2), y: snap(center.y - size.height / 2), ...size, file: filePath };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    setSelection(new Set([node.id]));
  }

  function addLinkCard() {
    const url = window.prompt(t("canvas.linkPrompt"));
    if (!url) return;
    const center = screenToWorld(transformRef.current, (containerRef.current?.clientWidth ?? 800) / 2, (containerRef.current?.clientHeight ?? 600) / 2);
    const node: CanvasNode = { id: newNodeId(), type: "link", x: snap(center.x - 125), y: snap(center.y - 60), width: 250, height: 120, url };
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
    setSelection(new Set([node.id]));
  }

  function addGroup() {
    const selected = dataRef.current.nodes.filter((n) => selectionRef.current.has(n.id));
    const bounds = boundsOf(selected) ?? { x: 0, y: 0, width: 320, height: 220 };
    const pad = 24;
    const node: CanvasNode = {
      id: newNodeId(),
      type: "group",
      x: bounds.x - pad,
      y: bounds.y - pad,
      width: bounds.width + pad * 2,
      height: bounds.height + pad * 2,
      label: t("canvas.newGroupLabel"),
    };
    commit({ ...dataRef.current, nodes: [node, ...dataRef.current.nodes] });
    setSelection(new Set([node.id]));
  }

  function zoomBy(factor: number) {
    setTransform((t) => ({ ...t, k: Math.min(4, Math.max(0.1, t.k * factor)) }));
  }

  const editingNode = useMemo(
    () => data.nodes.find((n): n is TextNode => n.id === editingNodeId && n.type === "text"),
    [data.nodes, editingNodeId],
  );

  function commitTextEdit(text: string) {
    if (!editingNodeId) return;
    commit({
      ...dataRef.current,
      nodes: dataRef.current.nodes.map((n) => (n.id === editingNodeId ? { ...n, text } : n)),
    });
    setEditingNodeId(null);
  }

  return (
    <div className="canvas-tab" ref={containerRef}>
      <div className="canvas-toolbar">
        <button type="button" onClick={addTextCard}>
          {t("canvas.addText")}
        </button>
        <button type="button" onClick={() => setFilePickerOpen(true)}>
          {t("canvas.addFile")}
        </button>
        <button type="button" onClick={addLinkCard}>
          {t("canvas.addLink")}
        </button>
        <button type="button" onClick={addGroup}>
          {t("canvas.addGroup")}
        </button>
        <div className="canvas-zoom">
          <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
            <Minus size={14} />
          </button>
          <span>{Math.round(transform.k * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="canvas-surface">
        <canvas
          ref={canvasRef}
          className="canvas-2d"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
        />
        {editingNode && (
          <textarea
            className="canvas-text-editor"
            style={{
              left: editingNode.x * transform.k + transform.x,
              top: editingNode.y * transform.k + transform.y,
              width: editingNode.width * transform.k,
              height: editingNode.height * transform.k,
              fontSize: `${13 * transform.k}px`,
            }}
            defaultValue={editingNode.text}
            autoFocus
            onBlur={(e) => commitTextEdit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") commitTextEdit((e.target as HTMLTextAreaElement).value);
            }}
          />
        )}
      </div>
      {filePickerOpen && <FilePickerDialog onPick={addFileCard} onClose={() => setFilePickerOpen(false)} />}
    </div>
  );
}

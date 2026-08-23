import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { select } from "d3-selection";
import {
  zoom,
  zoomIdentity,
  type ZoomBehavior,
  type ZoomTransform,
} from "d3-zoom";
import { quadtree as d3Quadtree, type Quadtree } from "d3-quadtree";
import { useSettingsStore } from "../../store/settingsStore";
import type { GraphData } from "../../types/vault";
import type {
  WorkerIn,
  WorkerLinkSpec,
  WorkerOut,
  WorkerNodeSpec,
} from "./graphWorker";
import "./ForceGraph.css";

interface ViewSize {
  w: number;
  h: number;
}

interface NodeMeta {
  path: string;
  title: string;
  baseRadius: number;
}

interface SimLink {
  from: number;
  to: number;
}

interface TooltipState {
  title: string;
  path: string;
  x: number;
  y: number;
}

export interface ForceGraphProps {
  data: GraphData | null;
  /** When set, only nodes within `depth` hops of this note are shown. */
  focusPath?: string | null;
  /** Relative to `focusPath`; used only when `focusPath` is set. */
  localDepth?: number;
  onOpenNote: (path: string, opts?: { split?: boolean }) => void;
  /** Disables pan/zoom/drag (used by the compact local graph). */
  compact?: boolean;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** Parses `#rrggbb`, `#rgb`, `rgb(...)` or `rgba(...)` into components. */
function parseColor(color: string): [number, number, number, number] {
  const clean = color.trim();
  const rgbaMatch = clean.match(
    /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?\s*\)$/,
  );
  if (rgbaMatch) {
    return [
      Number(rgbaMatch[1]),
      Number(rgbaMatch[2]),
      Number(rgbaMatch[3]),
      rgbaMatch[4] === undefined ? 1 : Number(rgbaMatch[4]),
    ];
  }
  const hex = clean.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [0, 0, 0, 1];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab, aa] = parseColor(a);
  const [br, bg, bb, ba] = parseColor(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const alpha = aa + (ba - aa) * t;
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function neighborhood(
  data: GraphData,
  focusPath: string,
  depth: number,
): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const link of data.links) {
    let set = adj.get(link.fromPath);
    if (!set) {
      set = new Set();
      adj.set(link.fromPath, set);
    }
    set.add(link.toPath);
    set = adj.get(link.toPath);
    if (!set) {
      set = new Set();
      adj.set(link.toPath, set);
    }
    set.add(link.fromPath);
  }

  const result = new Set([focusPath]);
  let frontier = [focusPath];
  for (let d = 0; d < depth; d += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbor of adj.get(current) ?? []) {
        if (!result.has(neighbor)) {
          result.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return result;
}

export function ForceGraph({
  data,
  focusPath,
  localDepth = 2,
  onOpenNote,
  compact = false,
}: ForceGraphProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphSettings = useSettingsStore((s) => s.settings.graph);

  const workerRef = useRef<Worker | null>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const metaRef = useRef<NodeMeta[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const adjRef = useRef<Map<string, number[]>>(new Map());
  const positionsRef = useRef<Float32Array | null>(null);
  const settledRef = useRef(false);
  const scaleArrRef = useRef<Float32Array>(new Float32Array(0));
  const hoverArrRef = useRef<Float32Array>(new Float32Array(0));
  const dragArrRef = useRef<Float32Array>(new Float32Array(0));
  const linkHeatRef = useRef<Float32Array>(new Float32Array(0));
  const quadRef = useRef<Quadtree<[number, number, number]> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const viewRef = useRef<ViewSize>({ w: 0, h: 0 });
  const hoverIndexRef = useRef<number | null>(null);
  const nodeAtDownRef = useRef<boolean | null>(null);
  const dragRef = useRef<{
    index: number;
    pointerId: number;
    moved: boolean;
    startSX: number;
    startSY: number;
  } | null>(null);
  const searchRef = useRef("");
  const fitPendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const rafRef = useRef(0);
  const focusPathRef = useRef<string | null>(null);
  focusPathRef.current = focusPath ?? null;

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    searchRef.current = search;
    dirtyRef.current = true;
  }, [search]);

  const localSet = useMemo(() => {
    if (!data || !focusPath) return null;
    return neighborhood(data, focusPath, localDepth);
  }, [data, focusPath, localDepth]);

  const requestDraw = useCallback(() => {
    dirtyRef.current = true;
    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(frame);
    }
  }, []);

  const rebuildQuad = useCallback(() => {
    const pos = positionsRef.current;
    const n = metaRef.current.length;
    if (!pos || n === 0) {
      quadRef.current = null;
      return;
    }
    const q = d3Quadtree<[number, number, number]>();
    for (let i = 0; i < n; i += 1) {
      q.add([pos[i * 2], pos[i * 2 + 1], i]);
    }
    quadRef.current = q;
  }, []);

  const applyFit = useCallback(() => {
    const pos = positionsRef.current;
    const meta = metaRef.current;
    const view = viewRef.current;
    if (!pos || meta.length === 0 || view.w === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < meta.length; i += 1) {
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = 90;
    const scale = Math.min(
      (view.w - pad * 2) / Math.max(maxX - minX, 1),
      (view.h - pad * 2) / Math.max(maxY - minY, 1),
      1.6,
    );
    const k = Math.max(scale, 0.05);
    const t = zoomIdentity
      .translate(view.w / 2 - ((minX + maxX) / 2) * k, view.h / 2 - ((minY + maxY) / 2) * k)
      .scale(k);
    if (zoomRef.current && canvasRef.current && !compact) {
      select(canvasRef.current).call(zoomRef.current.transform, t);
    } else {
      transformRef.current = t;
      dirtyRef.current = true;
      requestDraw();
    }
  }, [compact, requestDraw]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const pos = positionsRef.current;
    if (!canvas || !pos) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const view = viewRef.current;
    if (view.w === 0) return;

    const settings = useSettingsStore.getState().settings.graph;
    const meta = metaRef.current;
    const links = linksRef.current;
    const t = transformRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.fillStyle = settings.colors.background || cssVar("--bg-primary");
    ctx.fillRect(0, 0, view.w, view.h);

    const linkColor = settings.colors.link || cssVar("--graph-edge");
    const nodeColor = settings.colors.node || cssVar("--graph-node");
    const accent = settings.colors.accent || cssVar("--accent");
    const labelColor = cssVar("--text-normal");
    const labelFont = cssVar("--font-ui") || "sans-serif";

    const hoverIndex = hoverIndexRef.current;
    const query = searchRef.current.trim().toLowerCase();
    const queryOn = query !== "";

    let neighbor: Set<number> | null = null;
    if (hoverIndex !== null && meta[hoverIndex]) {
      neighbor = new Set([hoverIndex]);
      for (const ni of adjRef.current.get(meta[hoverIndex].path) ?? []) {
        neighbor.add(ni);
      }
    }
    const focusPathActive = focusPathRef.current;
    const focusSet = focusPathActive ? new Set([focusPathActive]) : null;

    // --- Edges ---
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const linkBaseAlpha = parseColor(linkColor)[3];
    ctx.lineWidth = 1 / t.k;
    for (let i = 0; i < links.length; i += 1) {
      const l = links[i];
      const aMeta = meta[l.from];
      const bMeta = meta[l.to];
      let dimmed =
        queryOn &&
        !aMeta.title.toLowerCase().includes(query) &&
        !bMeta.title.toLowerCase().includes(query);
      if (neighbor && !dimmed) {
        dimmed = !neighbor.has(l.from) && !neighbor.has(l.to);
      }
      const heat = linkHeatRef.current[i];
      ctx.strokeStyle = heat > 0.01 ? mix(linkColor, accent, heat) : linkColor;
      ctx.globalAlpha = dimmed ? linkBaseAlpha * 0.35 : linkBaseAlpha;
      ctx.beginPath();
      ctx.moveTo(pos[l.from * 2], pos[l.from * 2 + 1]);
      ctx.lineTo(pos[l.to * 2], pos[l.to * 2 + 1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- Nodes ---
    // Stays inside the same translate(t.x,t.y)+scale(t.k) block as the
    // edges above — this used to restore() before drawing nodes, which
    // left them at their raw simulation (graph-space) coordinates while
    // edges and labels both correctly tracked pan/zoom. At the identity
    // transform (freshly opened, unzoomed) that's invisible; the moment
    // the user actually zooms or pans, nodes stay frozen where they were
    // while the label (computed independently in screen space below)
    // keeps following them — reading as the label drifting away, when
    // really it was the node that never moved.
    const sizeMult = Math.min(Math.max(settings.nodeSize / 6, 0.5), 2.5);
    for (let i = 0; i < meta.length; i += 1) {
      const m = meta[i];
      const scaleV = easeOutCubic(scaleArrRef.current[i] ?? 1);
      const hoverV = hoverArrRef.current[i] ?? 0;
      const dragV = dragArrRef.current[i] ?? 0;
      const dimmed = queryOn && !m.title.toLowerCase().includes(query);
      const highlighted =
        neighbor === null || neighbor.has(i) || (focusSet?.has(m.path) ?? false);
      const radius =
        m.baseRadius * sizeMult * Math.max(0.15, scaleV) *
        (1 + 0.45 * hoverV + 0.22 * dragV);
      let color = nodeColor;
      if (focusSet?.has(m.path)) color = accent;
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      if (hoverV > 0.02) {
        ctx.shadowColor = accent;
        ctx.shadowBlur = 14 * hoverV;
      }
      ctx.globalAlpha = scaleV * (dimmed ? 0.12 : highlighted ? 1 : 0.25);
      ctx.fillStyle = mix(color, accent, hoverV * 0.35);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // --- Labels: screen-space pass, constant 13px, hidden while the
    // layout is still settling and at low zoom. ---
    if (settings.showLabels && settledRef.current && t.k >= 0.4) {
      const zoomAlpha = Math.min(1, Math.max(0, (t.k - 0.4) / 0.5));
      ctx.font = `13px ${labelFont}`;
      ctx.textAlign = "center";
      for (let i = 0; i < meta.length; i += 1) {
        const m = meta[i];
        if (queryOn && !m.title.toLowerCase().includes(query)) continue;
        const scaleV = easeOutCubic(scaleArrRef.current[i] ?? 1);
        const hoverV = hoverArrRef.current[i] ?? 0;
        const labelAlpha = scaleV * zoomAlpha * (0.72 + 0.28 * hoverV);
        if (labelAlpha <= 0.03) continue;
        const sx = t.x + pos[i * 2] * t.k;
        const sy = t.y + pos[i * 2 + 1] * t.k;
        if (sx < -160 || sx > view.w + 160 || sy < -20 || sy > view.h + 20) {
          continue;
        }
        const radius =
          m.baseRadius * sizeMult * Math.max(0.15, scaleV);
        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = labelColor;
        ctx.fillText(m.title, sx, sy + radius * t.k + 8);
      }
      ctx.globalAlpha = 1;
    }
  }, []);

  const frame = useCallback(() => {
    rafRef.current = 0;
    const n = metaRef.current.length;

    if (n === 0) {
      settledRef.current = true;
      dirtyRef.current = false;
      return;
    }

    const hoverIndex = hoverIndexRef.current;
    let neighbor: Set<number> | null = null;
    if (hoverIndex !== null && metaRef.current[hoverIndex]) {
      neighbor = new Set([hoverIndex]);
      for (const ni of adjRef.current.get(metaRef.current[hoverIndex].path) ?? []) {
        neighbor.add(ni);
      }
    }
    const dragIndex = dragRef.current?.index ?? null;

    let animating = false;
    for (let i = 0; i < n; i += 1) {
      const targetHover = hoverIndex !== null ? (neighbor?.has(i) ? 1 : 0.25) : 0;
      const h = hoverArrRef.current[i] ?? 0;
      if (Math.abs(h - targetHover) > 0.004) {
        hoverArrRef.current[i] = h + (targetHover - h) * 0.18;
        animating = true;
      }
      const targetDrag = dragIndex === i ? 1 : 0;
      const d = dragArrRef.current[i] ?? 0;
      if (Math.abs(d - targetDrag) > 0.004) {
        dragArrRef.current[i] = d + (targetDrag - d) * 0.25;
        animating = true;
      }
      if ((scaleArrRef.current[i] ?? 1) < 1) {
        scaleArrRef.current[i] = Math.min(1, (scaleArrRef.current[i] ?? 1) + 0.055);
        animating = true;
      }
    }
    const links = linksRef.current;
    for (let i = 0; i < links.length; i += 1) {
      const l = links[i];
      const target = neighbor
        ? neighbor.has(l.from) || neighbor.has(l.to)
          ? 1
          : 0
        : 0;
      const cur = linkHeatRef.current[i] ?? 0;
      if (Math.abs(cur - target) > 0.004) {
        linkHeatRef.current[i] = cur + (target - cur) * 0.15;
        animating = true;
      }
    }

    const keepGoing = !settledRef.current || animating || dirtyRef.current;
    if (keepGoing) {
      dirtyRef.current = false;
      drawFrame();
    }
    if (!settledRef.current || animating || dirtyRef.current) {
      rafRef.current = requestAnimationFrame(frame);
    }
  }, [drawFrame]);

  // Simulation worker: receives Float32Array positions on every tick.
  useEffect(() => {
    const worker = new Worker(new URL("./graphWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type !== "tick") return;
      positionsRef.current = msg.positions;
      settledRef.current = msg.settled;
      if (msg.settled) {
        rebuildQuad();
        if (fitPendingRef.current) {
          fitPendingRef.current = false;
          applyFit();
        }
      }
      requestDraw();
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [applyFit, rebuildQuad, requestDraw]);

  // Build the node/link model and (re)start the simulation.
  useEffect(() => {
    if (!data) return;
    const settings = useSettingsStore.getState().settings.graph;
    const visible = new Set(data.nodes.map((node) => node.path));
    if (localSet) {
      for (const path of visible) {
        if (!localSet.has(path)) visible.delete(path);
      }
    }

    const degree = new Map<string, number>();
    for (const link of data.links) {
      degree.set(link.fromPath, (degree.get(link.fromPath) ?? 0) + 1);
      degree.set(link.toPath, (degree.get(link.toPath) ?? 0) + 1);
    }
    let maxDegree = 0;
    for (const value of degree.values()) maxDegree = Math.max(maxDegree, value);

    const meta: NodeMeta[] = [];
    const byPath = new Map<string, number>();
    for (const node of data.nodes) {
      if (!visible.has(node.path)) continue;
      const deg = degree.get(node.path) ?? 0;
      meta.push({
        path: node.path,
        title: node.title,
        baseRadius: maxDegree > 0 ? 4 + 10 * Math.sqrt(deg / maxDegree) : 4,
      });
      byPath.set(node.path, meta.length - 1);
    }

    const links: SimLink[] = [];
    const adj = new Map<string, number[]>();
    for (const link of data.links) {
      const from = byPath.get(link.fromPath);
      const to = byPath.get(link.toPath);
      if (from === undefined || to === undefined) continue;
      links.push({ from, to });
      let set = adj.get(meta[from].path);
      if (!set) {
        set = [];
        adj.set(meta[from].path, set);
      }
      set.push(to);
      set = adj.get(meta[to].path);
      if (!set) {
        set = [];
        adj.set(meta[to].path, set);
      }
      set.push(from);
    }

    const n = meta.length;
    metaRef.current = meta;
    linksRef.current = links;
    adjRef.current = adj;
    scaleArrRef.current = new Float32Array(n);
    hoverArrRef.current = new Float32Array(n);
    dragArrRef.current = new Float32Array(n);
    linkHeatRef.current = new Float32Array(links.length);
    quadRef.current = null;
    settledRef.current = false;
    fitPendingRef.current = true;

    const view = viewRef.current;
    workerRef.current?.postMessage({
      type: "init",
      specs: meta.map((m): WorkerNodeSpec => ({ path: m.path })),
      links: links.map((l): WorkerLinkSpec => ({ from: l.from, to: l.to })),
      linkDistance: settings.linkDistance,
      repulsion: settings.repulsion,
      cx: view.w / 2,
      cy: view.h / 2,
    } satisfies WorkerIn);
    requestDraw();
  }, [data, localSet, graphSettings.linkDistance, requestDraw]);

  // Force settings changed: update the worker and let the layout re-settle.
  useEffect(() => {
    workerRef.current?.postMessage({
      type: "settings",
      linkDistance: graphSettings.linkDistance,
      repulsion: graphSettings.repulsion,
    } satisfies WorkerIn);
    requestDraw();
  }, [graphSettings.linkDistance, graphSettings.repulsion, requestDraw]);

  // Canvas sizing: never restarts the simulation.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      viewRef.current = { w: rect.width, h: rect.height };
      workerRef.current?.postMessage({
        type: "center",
        cx: rect.width / 2,
        cy: rect.height / 2,
      } satisfies WorkerIn);
      dirtyRef.current = true;
      requestDraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [requestDraw]);

  // d3-zoom: wheel zooms to the cursor, drag on empty space pans.
  useEffect(() => {
    if (compact) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, 8])
      .filter((event) => {
        if (event.type === "dblclick") return false;
        if (!event.ctrlKey || event.type === "wheel") {
          if (event.type === "mousedown" || event.type === "touchstart") {
            return nodeAtDownRef.current === false;
          }
          return !event.button;
        }
        return false;
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        dirtyRef.current = true;
        requestDraw();
      });
    zoomRef.current = z;
    select(canvas).call(z);
    return () => {
      select(canvas).on(".zoom", null);
      zoomRef.current = null;
    };
  }, [compact, requestDraw]);

  // Compact local graph: refit after every layout settle.
  useEffect(() => {
    if (!compact) return;
    fitPendingRef.current = true;
  }, [compact, localSet]);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const t = transformRef.current;
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
  }, []);

  const hitTest = useCallback((wx: number, wy: number): number => {
    const pos = positionsRef.current;
    const meta = metaRef.current;
    if (!pos || meta.length === 0) return -1;
    const quad = quadRef.current;
    if (quad) {
      const found = quad.find(wx, wy, 40);
      if (found) {
        const i = found[2];
        const dx = pos[i * 2] - wx;
        const dy = pos[i * 2 + 1] - wy;
        const hitRadius = meta[i].baseRadius * 2 + 8;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
      }
      return -1;
    }
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < meta.length; i += 1) {
      const dx = pos[i * 2] - wx;
      const dy = pos[i * 2 + 1] - wy;
      const dist = dx * dx + dy * dy;
      const hitRadius = meta[i].baseRadius * 2 + 8;
      if (dist < hitRadius * hitRadius && dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }, []);

  const sendPin = useCallback(
    (index: number, pinned: boolean, x?: number, y?: number) => {
      workerRef.current?.postMessage({
        type: "pin",
        index,
        x,
        y,
        pinned,
      } satisfies WorkerIn);
    },
    [],
  );

  const setHoverIndex = useCallback(
    (index: number | null, clientX?: number, clientY?: number) => {
      hoverIndexRef.current = index;
      if (index !== null && clientX !== undefined && clientY !== undefined) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const m = metaRef.current[index];
        setTooltip({
          title: m?.title ?? "",
          path: m?.path ?? "",
          x: clientX - (rect?.left ?? 0),
          y: clientY - (rect?.top ?? 0),
        });
      } else {
        setTooltip(null);
      }
      requestDraw();
    },
    [requestDraw],
  );

  // Pointer interactions (skipped in compact mode): node drag on hit,
  // d3-zoom handles pan/zoom on empty space.
  useEffect(() => {
    if (compact) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = () => canvas.getBoundingClientRect();

    const onPointerDown = (e: PointerEvent) => {
      const sx = e.clientX - rect().left;
      const sy = e.clientY - rect().top;
      const world = screenToWorld(sx, sy);
      const index = hitTest(world.x, world.y);
      if (index >= 0) {
        nodeAtDownRef.current = true;
        dragRef.current = {
          index,
          pointerId: e.pointerId,
          moved: false,
          startSX: sx,
          startSY: sy,
        };
        canvas.setPointerCapture(e.pointerId);
        sendPin(index, true);
        requestDraw();
      } else {
        nodeAtDownRef.current = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const sx = e.clientX - rect().left;
      const sy = e.clientY - rect().top;

      const drag = dragRef.current;
      if (drag && e.pointerId === drag.pointerId) {
        if (
          !drag.moved &&
          (Math.abs(sx - drag.startSX) > 3 || Math.abs(sy - drag.startSY) > 3)
        ) {
          drag.moved = true;
        }
        const world = screenToWorld(sx, sy);
        sendPin(drag.index, true, world.x, world.y);
        requestDraw();
        return;
      }

      if (e.buttons !== 0) return;

      const world = screenToWorld(sx, sy);
      const index = hitTest(world.x, world.y);
      setHoverIndex(index, e.clientX, e.clientY);
      canvas.style.cursor = index >= 0 ? "pointer" : "grab";
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && e.pointerId === drag.pointerId) {
        dragRef.current = null;
        nodeAtDownRef.current = null;
        sendPin(drag.index, false);
        if (!drag.moved) {
          const path = metaRef.current[drag.index]?.path;
          if (path) {
            if (e.ctrlKey || e.metaKey) {
              onOpenNote(path, { split: true });
            } else {
              onOpenNote(path);
            }
          }
        }
        requestDraw();
        return;
      }
      nodeAtDownRef.current = null;
    };

    canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, [compact, hitTest, onOpenNote, screenToWorld, sendPin, setHoverIndex, requestDraw]);

  const zoomBy = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      const z = zoomRef.current;
      if (!canvas || !z) return;
      const view = viewRef.current;
      const t = transformRef.current;
      const next = t
        .translate(view.w / 2, view.h / 2)
        .scale(factor)
        .translate(-view.w / 2, -view.h / 2);
      select(canvas).call(z.transform, next);
    },
    [],
  );

  const fitNow = useCallback(() => {
    fitPendingRef.current = true;
    applyFit();
  }, [applyFit]);

  const resetLayout = useCallback(() => {
    const settings = useSettingsStore.getState().settings.graph;
    workerRef.current?.postMessage({
      type: "reset",
      linkDistance: settings.linkDistance,
    } satisfies WorkerIn);
    settledRef.current = false;
    fitPendingRef.current = true;
    requestDraw();
  }, [requestDraw]);

  return (
    <div
      ref={containerRef}
      className={`force-graph${compact ? " force-graph-compact" : ""}`}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <canvas ref={canvasRef} className="force-graph-canvas" />
      {tooltip && (
        <div
          className="force-graph-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <span className="force-graph-tooltip-title">{tooltip.title}</span>
          <span className="force-graph-tooltip-path">{tooltip.path}</span>
        </div>
      )}
      {!compact && (
        <div className="graph-card">
          {collapsed ? (
            <button
              type="button"
              className="graph-card-btn"
              title={t("graph.settings")}
              onClick={() => setCollapsed(false)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <circle cx="8" cy="8" r="2" />
                <path d="M13 8.5a5 5 0 0 0-.1-1l1.4-1.1-.9-1.6-1.6.6a5 5 0 0 0-1.7-1L9.8 1.7H7.6l-.3 1.7a5 5 0 0 0-1.7 1l-1.6-.6-.9 1.6 1.4 1.1a5 5 0 0 0 0 2l-1.4 1.1.9 1.6 1.6-.6a5 5 0 0 0 1.7 1l.3 1.7h2.2l.3-1.7a5 5 0 0 0 1.7-1l1.6.6.9-1.6-1.4-1.1a5 5 0 0 0 .1-1z" />
              </svg>
            </button>
          ) : (
            <>
              <div className="graph-search-wrap">
                <svg
                  className="graph-search-icon"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                >
                  <circle cx="7" cy="7" r="4.2" />
                  <path d="m10.5 10.5 3 3" />
                </svg>
                <input
                  type="search"
                  className="field graph-search"
                  placeholder={t("graph.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="graph-card-divider" />
              <div className="graph-card-actions">
                <button
                  type="button"
                  className="graph-card-btn"
                  title={t("graph.zoomIn")}
                  onClick={() => zoomBy(1.25)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="graph-card-btn"
                  title={t("graph.zoomOut")}
                  onClick={() => zoomBy(0.8)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M3 8h10" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="graph-card-btn"
                  title={t("graph.fit")}
                  onClick={fitNow}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
                    <path d="M6 6h4v4H6z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="graph-card-btn"
                  title={t("graph.resetLayout")}
                  onClick={resetLayout}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                    <path d="M13.5 2v2.5H11" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="graph-card-btn"
                  title={t("graph.collapse")}
                  onClick={() => setCollapsed(true)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="m6 4 4 4-4 4" />
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
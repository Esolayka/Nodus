import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Application, Container, Graphics, Text } from "pixi.js";
import { select } from "d3-selection";
import {
  zoom,
  zoomIdentity,
  type ZoomBehavior,
  type ZoomTransform,
} from "d3-zoom";
import { quadtree as d3Quadtree, type Quadtree } from "d3-quadtree";
import { searchVault } from "../../api/vault";
import { useSettingsStore } from "../../store/settingsStore";
import type { GraphData } from "../../types/vault";
import { GraphControls } from "./GraphControls";
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
  kind: "note" | "tag" | "attachment" | "unresolved";
  createdAt: number;
  groupColor: string | null;
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

interface TimelineState {
  startedAt: number;
  from: number;
  to: number;
  cutoff: number;
  running: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  index: number;
}

interface PixiGraphScene {
  app: Application;
  world: Container;
  links: Graphics;
  nodes: Graphics;
  labelsLayer: Container;
  labels: Text[];
  labelMeta: NodeMeta[] | null;
  labelStyleKey: string;
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

function pixiPaint(color: string, alpha = 1): { color: number; alpha: number } {
  const [r, g, b, sourceAlpha] = parseColor(color);
  return {
    color: (r << 16) | (g << 8) | b,
    alpha: Math.min(1, Math.max(0, sourceAlpha * alpha)),
  };
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
  const pixiRef = useRef<PixiGraphScene | null>(null);
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
  const fitPendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const rafRef = useRef(0);
  const viewAnimationRef = useRef(0);
  const viewAnimationLastRef = useRef(0);
  const viewTargetRef = useRef<ZoomTransform | null>(null);
  const focusPathRef = useRef<string | null>(null);
  const timelineRef = useRef<TimelineState | null>(null);
  focusPathRef.current = focusPath ?? null;

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [search, setSearch] = useState("");
  const [searchMatches, setSearchMatches] = useState<Set<string> | null>(null);
  const [groupMatches, setGroupMatches] = useState<Map<string, Set<string>>>(new Map());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setSearchMatches(null);
      return;
    }
    setSearchMatches(null);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchVault(query, false)
        .then((results) => {
          if (!cancelled) setSearchMatches(new Set(results.map((result) => result.path)));
        })
        .catch(() => {
          if (!cancelled) setSearchMatches(new Set());
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const groups = graphSettings.groups.filter((group) => group.query.trim());
    if (groups.length === 0) {
      setGroupMatches(new Map());
      return;
    }
    void Promise.all(
      groups.map(async (group) => {
        const results = await searchVault(group.query, false);
        return [group.id, new Set(results.map((result) => result.path))] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setGroupMatches(new Map(entries));
      })
      .catch(() => {
        if (!cancelled) setGroupMatches(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [graphSettings.groups]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  const localSet = useMemo(() => {
    if (!data || !focusPath) return null;
    const allowed = new Set(
      data.nodes
        .filter((node) => {
          const kind = node.kind ?? "note";
          if (kind === "tag") return graphSettings.showTags;
          if (kind === "attachment") return graphSettings.showAttachments;
          if (kind === "unresolved") return !graphSettings.existingFilesOnly;
          return true;
        })
        .map((node) => node.path),
    );
    return neighborhood(
      {
        nodes: data.nodes.filter((node) => allowed.has(node.path)),
        links: data.links.filter(
          (link) => allowed.has(link.fromPath) && allowed.has(link.toPath),
        ),
      },
      focusPath,
      localDepth,
    );
  }, [
    data,
    focusPath,
    localDepth,
    graphSettings.showTags,
    graphSettings.showAttachments,
    graphSettings.existingFilesOnly,
  ]);

  const requestDraw = useCallback(() => {
    dirtyRef.current = true;
    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(frame);
    }
  }, []);

  const stopViewAnimation = useCallback(() => {
    if (viewAnimationRef.current !== 0) {
      cancelAnimationFrame(viewAnimationRef.current);
      viewAnimationRef.current = 0;
    }
    viewTargetRef.current = null;
  }, []);

  const animateViewTo = useCallback((target: ZoomTransform) => {
    viewTargetRef.current = target;
    if (viewAnimationRef.current !== 0) return;

    viewAnimationLastRef.current = performance.now();
    const step = (now: number) => {
      const canvas = canvasRef.current;
      const z = zoomRef.current;
      const destination = viewTargetRef.current;
      if (!canvas || !z || !destination) {
        viewAnimationRef.current = 0;
        return;
      }

      const current = transformRef.current;
      const elapsed = Math.min(48, Math.max(1, now - viewAnimationLastRef.current));
      viewAnimationLastRef.current = now;
      const blend = 1 - Math.exp(-elapsed / 72);
      const nextK = Math.exp(
        Math.log(current.k) + (Math.log(destination.k) - Math.log(current.k)) * blend,
      );
      const next = zoomIdentity
        .translate(
          current.x + (destination.x - current.x) * blend,
          current.y + (destination.y - current.y) * blend,
        )
        .scale(nextK);
      const finished =
        Math.abs(next.x - destination.x) < 0.08 &&
        Math.abs(next.y - destination.y) < 0.08 &&
        Math.abs(next.k - destination.k) < 0.0005;

      select(canvas).call(z.transform, finished ? destination : next);
      if (finished) {
        viewAnimationRef.current = 0;
        viewTargetRef.current = null;
      } else {
        viewAnimationRef.current = requestAnimationFrame(step);
      }
    };
    viewAnimationRef.current = requestAnimationFrame(step);
  }, []);

  const zoomViewAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      const base = viewTargetRef.current ?? transformRef.current;
      const nextK = Math.min(8, Math.max(0.15, base.k * factor));
      if (Math.abs(nextK - base.k) < 0.00001) return;
      const worldX = (sx - base.x) / base.k;
      const worldY = (sy - base.y) / base.k;
      animateViewTo(
        zoomIdentity
          .translate(sx - worldX * nextK, sy - worldY * nextK)
          .scale(nextK),
      );
    },
    [animateViewTo],
  );

  const panViewBy = useCallback(
    (dx: number, dy: number) => {
      const base = viewTargetRef.current ?? transformRef.current;
      animateViewTo(zoomIdentity.translate(base.x + dx, base.y + dy).scale(base.k));
    },
    [animateViewTo],
  );

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
    const k = Math.max(scale, 0.15);
    const t = zoomIdentity
      .translate(view.w / 2 - ((minX + maxX) / 2) * k, view.h / 2 - ((minY + maxY) / 2) * k)
      .scale(k);
    if (zoomRef.current && canvasRef.current && !compact) {
      animateViewTo(t);
    } else {
      transformRef.current = t;
      dirtyRef.current = true;
      requestDraw();
    }
  }, [animateViewTo, compact, requestDraw]);

  const drawFrame = useCallback(() => {
    const scene = pixiRef.current;
    const pos = positionsRef.current;
    if (!scene || !pos) return;
    const dpr = window.devicePixelRatio || 1;
    const view = viewRef.current;
    if (view.w === 0) return;

    const { app, world, links: linkGraphics, nodes: nodeGraphics, labelsLayer } = scene;
    const settings = useSettingsStore.getState().settings.graph;
    const meta = metaRef.current;
    const links = linksRef.current;
    const t = transformRef.current;
    app.renderer.background.color = settings.colors.background || cssVar("--bg-primary");
    world.position.set(t.x, t.y);
    world.scale.set(t.k);

    const linkColor = settings.colors.link || cssVar("--graph-edge");
    const nodeColor = settings.colors.node || cssVar("--graph-node");
    const accent = settings.colors.accent || cssVar("--accent");
    const labelColor = cssVar("--text-normal");
    const faintColor = cssVar("--text-faint");
    const labelFont = cssVar("--font-ui") || "sans-serif";
    const sizeMult = Math.min(Math.max(settings.nodeSize, 0.1), 5);
    const animationCutoff = timelineRef.current?.cutoff ?? Infinity;
    const isRevealed = (index: number) => (meta[index]?.createdAt ?? 0) <= animationCutoff;

    const hoverIndex = hoverIndexRef.current;

    let neighbor: Set<number> | null = null;
    if (hoverIndex !== null && meta[hoverIndex]) {
      neighbor = new Set([hoverIndex]);
      for (const ni of adjRef.current.get(meta[hoverIndex].path) ?? []) {
        neighbor.add(ni);
      }
    }
    const focusPathActive = focusPathRef.current;
    const focusSet = focusPathActive ? new Set([focusPathActive]) : null;

    // The simulation keeps producing plain graph-space coordinates. PixiJS
    // owns the GPU scene: one transformed world layer for geometry and a
    // separate screen-space layer for labels that stay sharp while zooming.
    linkGraphics.clear();
    for (let i = 0; i < links.length; i += 1) {
      const l = links[i];
      if (!isRevealed(l.from) || !isRevealed(l.to)) continue;
      const dimmed = !!neighbor && !neighbor.has(l.from) && !neighbor.has(l.to);
      const heat = linkHeatRef.current[i];
      const paint = pixiPaint(
        heat > 0.01 ? mix(linkColor, accent, heat) : linkColor,
        dimmed ? 0.25 : 1,
      );
      const fromX = pos[l.from * 2];
      const fromY = pos[l.from * 2 + 1];
      const toX = pos[l.to * 2];
      const toY = pos[l.to * 2 + 1];
      linkGraphics
        .moveTo(fromX, fromY)
        .lineTo(toX, toY)
        .stroke({
          color: paint.color,
          alpha: paint.alpha,
          width: settings.linkThickness / t.k,
          cap: "round",
          join: "round",
        });
      if (settings.showArrows) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const targetRadius = meta[l.to].baseRadius * sizeMult + 4 / t.k;
        const tipX = toX - Math.cos(angle) * targetRadius;
        const tipY = toY - Math.sin(angle) * targetRadius;
        const arrowSize = 5 / t.k;
        linkGraphics
          .poly([
            tipX,
            tipY,
            tipX - Math.cos(angle - Math.PI / 6) * arrowSize,
            tipY - Math.sin(angle - Math.PI / 6) * arrowSize,
            tipX - Math.cos(angle + Math.PI / 6) * arrowSize,
            tipY - Math.sin(angle + Math.PI / 6) * arrowSize,
          ])
          .fill(paint);
      }
    }

    nodeGraphics.clear();
    for (let i = 0; i < meta.length; i += 1) {
      const m = meta[i];
      if (!isRevealed(i)) continue;
      const scaleV = easeOutCubic(scaleArrRef.current[i] ?? 1);
      const hoverV = hoverArrRef.current[i] ?? 0;
      const dragV = dragArrRef.current[i] ?? 0;
      const highlighted =
        neighbor === null || neighbor.has(i) || (focusSet?.has(m.path) ?? false);
      const radius =
        m.baseRadius * sizeMult * Math.max(0.15, scaleV) *
        (1 + 0.45 * hoverV + 0.22 * dragV);
      let color = m.groupColor ?? nodeColor;
      if (!m.groupColor && m.kind === "tag") color = mix(nodeColor, accent, 0.62);
      if (!m.groupColor && m.kind === "attachment") color = mix(nodeColor, labelColor, 0.28);
      if (!m.groupColor && m.kind === "unresolved") color = faintColor;
      if (focusSet?.has(m.path)) color = accent;
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      if (hoverV > 0.02) {
        nodeGraphics
          .circle(x, y, radius + 8 / t.k)
          .fill(pixiPaint(accent, 0.12 * hoverV));
      }
      nodeGraphics
        .circle(x, y, radius)
        .fill(pixiPaint(mix(color, accent, hoverV * 0.35), scaleV * (highlighted ? 1 : 0.25)));
    }

    const labelStyleKey = `${labelFont}\u0000${labelColor}\u0000${dpr}`;
    if (scene.labelMeta !== meta || scene.labelStyleKey !== labelStyleKey) {
      labelsLayer.removeChildren();
      for (const label of scene.labels) {
        label.destroy({ texture: true, textureSource: true });
      }
      scene.labels = meta.map((node) => new Text({
        text: node.title,
        style: {
          fill: pixiPaint(labelColor).color,
          fontFamily: labelFont,
          fontSize: 13,
        },
        anchor: { x: 0.5, y: 0 },
        resolution: dpr,
      }));
      labelsLayer.addChild(...scene.labels);
      scene.labelMeta = meta;
      scene.labelStyleKey = labelStyleKey;
    }

    const fadeStart = Math.min(1.15, Math.max(0.12, 0.42 + settings.textFadeThreshold * 0.1));
    const labelsVisible = settings.showLabels && t.k >= fadeStart;
    labelsLayer.visible = labelsVisible;
    if (labelsVisible) {
      const zoomAlpha = Math.min(1, Math.max(0, (t.k - fadeStart) / 0.5));
      for (let i = 0; i < meta.length; i += 1) {
        const m = meta[i];
        const label = scene.labels[i];
        if (!isRevealed(i)) {
          label.visible = false;
          continue;
        }
        const scaleV = easeOutCubic(scaleArrRef.current[i] ?? 1);
        const hoverV = hoverArrRef.current[i] ?? 0;
        const neighborhoodAlpha = neighbor && !neighbor.has(i) ? 0.25 : 1;
        const labelAlpha = scaleV * zoomAlpha * neighborhoodAlpha * (0.72 + 0.28 * hoverV);
        if (labelAlpha <= 0.03) {
          label.visible = false;
          continue;
        }
        const sx = t.x + pos[i * 2] * t.k;
        const sy = t.y + pos[i * 2 + 1] * t.k;
        if (sx < -160 || sx > view.w + 160 || sy < -20 || sy > view.h + 20) {
          label.visible = false;
          continue;
        }
        const radius = m.baseRadius * sizeMult * Math.max(0.15, scaleV);
        label.visible = true;
        label.alpha = labelAlpha;
        label.position.set(sx, sy + radius * t.k + 8);
      }
    }
    app.render();
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
    const timeline = timelineRef.current;
    if (timeline?.running) {
      const progress = Math.min(1, (performance.now() - timeline.startedAt) / 10_000);
      timeline.cutoff = timeline.from + (timeline.to - timeline.from) * progress;
      timeline.running = progress < 1;
      animating = timeline.running;
      dirtyRef.current = true;
    }
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
      const revealed = (metaRef.current[i]?.createdAt ?? 0) <= (timeline?.cutoff ?? Infinity);
      if (!revealed) {
        scaleArrRef.current[i] = 0;
      } else if ((scaleArrRef.current[i] ?? 1) < 1) {
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let initialized = false;
    const app = new Application();

    void Promise.resolve().then(async () => {
      // React StrictMode mounts, immediately cleans up, and mounts effects
      // again in development. Deferring one microtask prevents that probe
      // from starting two renderers against the same canvas concurrently.
      if (disposed) return;
      await app.init({
        canvas,
        width: Math.max(1, viewRef.current.w || canvas.clientWidth),
        height: Math.max(1, viewRef.current.h || canvas.clientHeight),
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        autoStart: false,
        antialias: true,
        background: cssVar("--bg-primary"),
        preference: ["webgl", "canvas"],
        powerPreference: "high-performance",
        roundPixels: false,
      });
      initialized = true;
      if (disposed) {
        app.destroy(false, { children: true, texture: true, textureSource: true, context: true });
        return;
      }
      const world = new Container();
      const linkGraphics = new Graphics();
      const nodeGraphics = new Graphics();
      const labelsLayer = new Container();
      world.addChild(linkGraphics, nodeGraphics);
      app.stage.addChild(world, labelsLayer);
      pixiRef.current = {
        app,
        world,
        links: linkGraphics,
        nodes: nodeGraphics,
        labelsLayer,
        labels: [],
        labelMeta: null,
        labelStyleKey: "",
      };
      const view = viewRef.current;
      if (view.w > 0 && view.h > 0) {
        app.renderer.resize(view.w, view.h, window.devicePixelRatio || 1);
      }
      dirtyRef.current = true;
      requestDraw();
    }).catch((error) => {
      if (!disposed) console.error("[graph] PixiJS renderer initialization failed:", error);
    });

    return () => {
      disposed = true;
      if (pixiRef.current?.app === app) pixiRef.current = null;
      if (initialized) {
        app.destroy(false, { children: true, texture: true, textureSource: true, context: true });
      }
    };
  }, [requestDraw]);

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
    const query = search.trim().toLowerCase();
    const visible = new Set<string>();
    const nodeKind = new Map(
      data.nodes.map((node) => [node.path, node.kind ?? "note"] as const),
    );
    for (const node of data.nodes) {
      const kind = node.kind ?? "note";
      if (kind === "tag" && !settings.showTags) continue;
      if (kind === "attachment" && !settings.showAttachments) continue;
      if (kind === "unresolved" && settings.existingFilesOnly) continue;
      if (localSet && !localSet.has(node.path)) continue;
      if (query) {
        const noteMatch = kind === "note" && searchMatches?.has(node.path);
        const directMatch =
          kind !== "note" &&
          (node.title.toLowerCase().includes(query) || node.path.toLowerCase().includes(query));
        if (!noteMatch && !directMatch) continue;
      }
      visible.add(node.path);
    }

    // Non-note nodes adjacent to a matching note remain visible, mirroring
    // Obsidian's behavior when a file query is combined with tag or
    // attachment nodes.
    if (query && searchMatches) {
      for (const link of data.links) {
        if (searchMatches.has(link.fromPath) && nodeKind.get(link.toPath) !== "note") {
          const kind = nodeKind.get(link.toPath);
          if (kind === "tag" && settings.showTags) visible.add(link.toPath);
          if (kind === "attachment" && settings.showAttachments) visible.add(link.toPath);
          if (kind === "unresolved" && !settings.existingFilesOnly) visible.add(link.toPath);
        }
      }
    }

    let visibleLinks = data.links.filter(
      (link) => visible.has(link.fromPath) && visible.has(link.toPath),
    );
    if (!settings.showOrphans) {
      const connected = new Set<string>();
      for (const link of visibleLinks) {
        connected.add(link.fromPath);
        connected.add(link.toPath);
      }
      for (const path of visible) {
        if (!connected.has(path)) visible.delete(path);
      }
      visibleLinks = visibleLinks.filter(
        (link) => visible.has(link.fromPath) && visible.has(link.toPath),
      );
    }

    const incoming = new Map<string, number>();
    for (const link of visibleLinks) {
      incoming.set(link.toPath, (incoming.get(link.toPath) ?? 0) + 1);
    }
    let maxIncoming = 0;
    for (const value of incoming.values()) maxIncoming = Math.max(maxIncoming, value);

    const meta: NodeMeta[] = [];
    const byPath = new Map<string, number>();
    for (const node of data.nodes) {
      if (!visible.has(node.path)) continue;
      const references = incoming.get(node.path) ?? 0;
      const groupColor = settings.groups.find((group) =>
        groupMatches.get(group.id)?.has(node.path),
      )?.color ?? null;
      meta.push({
        path: node.path,
        title: node.title,
        kind: node.kind ?? "note",
        createdAt: node.createdAt ?? 0,
        groupColor,
        baseRadius:
          maxIncoming > 0 ? 4 + 10 * Math.sqrt(references / maxIncoming) : 4,
      });
      byPath.set(node.path, meta.length - 1);
    }

    const links: SimLink[] = [];
    const adj = new Map<string, number[]>();
    for (const link of visibleLinks) {
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
      centerStrength: settings.centerStrength,
      linkStrength: settings.linkStrength,
      cx: view.w / 2,
      cy: view.h / 2,
    } satisfies WorkerIn);
    requestDraw();
  }, [
    data,
    localSet,
    search,
    searchMatches,
    groupMatches,
    graphSettings.showTags,
    graphSettings.showAttachments,
    graphSettings.existingFilesOnly,
    graphSettings.showOrphans,
    graphSettings.groups,
    graphSettings.linkDistance,
    graphSettings.repulsion,
    graphSettings.centerStrength,
    graphSettings.linkStrength,
    requestDraw,
  ]);

  // Force settings changed: update the worker and let the layout re-settle.
  useEffect(() => {
    workerRef.current?.postMessage({
      type: "settings",
      linkDistance: graphSettings.linkDistance,
      repulsion: graphSettings.repulsion,
      centerStrength: graphSettings.centerStrength,
      linkStrength: graphSettings.linkStrength,
    } satisfies WorkerIn);
    requestDraw();
  }, [
    graphSettings.linkDistance,
    graphSettings.repulsion,
    graphSettings.centerStrength,
    graphSettings.linkStrength,
    requestDraw,
  ]);

  // Canvas sizing: never restarts the simulation.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      viewRef.current = { w: rect.width, h: rect.height };
      pixiRef.current?.app.renderer.resize(
        Math.max(1, rect.width),
        Math.max(1, rect.height),
        dpr,
      );
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

  // d3 handles direct pan and pinch. Wheel/trackpad zoom is accumulated into
  // a target transform and eased on animation frames; applying every wheel
  // event immediately was the source of the old stepped, jittery motion.
  useEffect(() => {
    if (compact) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, 8])
      .filter((event) => {
        if (event.type === "dblclick" || event.type === "wheel") return false;
        if (!event.ctrlKey || event.type === "wheel") {
          if (event.type === "mousedown" || event.type === "touchstart") {
            return nodeAtDownRef.current === false;
          }
          return !event.button;
        }
        return false;
      })
      .on("start", (event) => {
        if (event.sourceEvent) stopViewAnimation();
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        if (viewAnimationRef.current === 0) {
          viewTargetRef.current = event.transform;
        }
        dirtyRef.current = true;
        requestDraw();
      });
    zoomRef.current = z;
    select(canvas).call(z);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const modeScale =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? Math.max(rect.height, 1)
            : 1;
      const delta = Math.max(-240, Math.min(240, event.deltaY * modeScale));
      const sensitivity = event.ctrlKey ? 0.006 : 0.002;
      zoomViewAt(
        Math.exp(-delta * sensitivity),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stopViewAnimation();
      canvas.removeEventListener("wheel", onWheel);
      select(canvas).on(".zoom", null);
      zoomRef.current = null;
    };
  }, [compact, requestDraw, stopViewAnimation, zoomViewAt]);

  // Compact local graph: refit after every layout settle.
  useEffect(() => {
    if (!compact) return;
    fitPendingRef.current = true;
  }, [compact, localSet]);

  useEffect(() => {
    if (compact) return;
    const fit = () => applyFit();
    document.addEventListener("nodus:graphFit", fit);
    return () => document.removeEventListener("nodus:graphFit", fit);
  }, [applyFit, compact]);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const t = transformRef.current;
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
  }, []);

  const hitTest = useCallback((wx: number, wy: number): number => {
    const pos = positionsRef.current;
    const meta = metaRef.current;
    if (!pos || meta.length === 0) return -1;
    const sizeMult = useSettingsStore.getState().settings.graph.nodeSize;
    const cutoff = timelineRef.current?.cutoff ?? Infinity;
    const quad = quadRef.current;
    if (quad) {
      const found = quad.find(wx, wy, 40);
      if (found) {
        const i = found[2];
        if ((meta[i].createdAt ?? 0) > cutoff) return -1;
        const dx = pos[i * 2] - wx;
        const dy = pos[i * 2 + 1] - wy;
        const hitRadius = meta[i].baseRadius * sizeMult + 8;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
      }
      return -1;
    }
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < meta.length; i += 1) {
      if ((meta[i].createdAt ?? 0) > cutoff) continue;
      const dx = pos[i * 2] - wx;
      const dy = pos[i * 2 + 1] - wy;
      const dist = dx * dx + dy * dy;
      const hitRadius = meta[i].baseRadius * sizeMult + 8;
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
      const validIndex = index !== null && index >= 0 && metaRef.current[index]
        ? index
        : null;
      hoverIndexRef.current = validIndex;
      if (validIndex !== null && clientX !== undefined && clientY !== undefined) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const m = metaRef.current[validIndex];
        setTooltip({
          title: m.title,
          path: m.path,
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
        canvas.style.cursor = "grabbing";
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
          const node = metaRef.current[drag.index];
          const canOpen =
            node?.kind === "note" ||
            (node?.kind === "attachment" && /\.(pdf|canvas)$/i.test(node.path));
          if (node && canOpen) {
            if (e.ctrlKey || e.metaKey) {
              onOpenNote(node.path, { split: true });
            } else {
              onOpenNote(node.path);
            }
          }
        }
        requestDraw();
        return;
      }
      nodeAtDownRef.current = null;
      canvas.style.cursor = "grab";
    };

    const onDoubleClick = (e: MouseEvent) => {
      const sx = e.clientX - rect().left;
      const sy = e.clientY - rect().top;
      const world = screenToWorld(sx, sy);
      if (hitTest(world.x, world.y) < 0) applyFit();
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const sx = e.clientX - rect().left;
      const sy = e.clientY - rect().top;
      const world = screenToWorld(sx, sy);
      const index = hitTest(world.x, world.y);
      const node = metaRef.current[index];
      const canOpen =
        node?.kind === "note" ||
        (node?.kind === "attachment" && /\.(pdf|canvas)$/i.test(node.path));
      setContextMenu(index >= 0 && canOpen ? { x: e.clientX, y: e.clientY, index } : null);
    };

    canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("contextmenu", onContextMenu);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [
    applyFit,
    compact,
    hitTest,
    onOpenNote,
    requestDraw,
    screenToWorld,
    sendPin,
    setHoverIndex,
  ]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const z = zoomRef.current;
    if (!canvas || !z) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      const view = viewRef.current;
      zoomViewAt(1.25, view.w / 2, view.h / 2);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      const view = viewRef.current;
      zoomViewAt(1 / 1.25, view.w / 2, view.h / 2);
      return;
    }
    const distance = event.shiftKey ? 80 : 28;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [distance, 0],
      ArrowRight: [-distance, 0],
      ArrowUp: [0, distance],
      ArrowDown: [0, -distance],
    };
    const delta = movement[event.key];
    if (delta) {
      event.preventDefault();
      panViewBy(delta[0], delta[1]);
    }
  }, [panViewBy, zoomViewAt]);

  const startAnimation = useCallback(() => {
    const times = metaRef.current.map((node) => node.createdAt).filter((value) => value > 0);
    if (times.length === 0) return;
    const from = Math.min(...times);
    const to = Math.max(...times);
    timelineRef.current = {
      startedAt: performance.now(),
      from: from - 1,
      to: Math.max(from + 1, to),
      cutoff: from - 1,
      running: true,
    };
    scaleArrRef.current.fill(0);
    requestDraw();
  }, [requestDraw]);

  return (
    <div
      ref={containerRef}
      className={`force-graph${compact ? " force-graph-compact" : ""}`}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <canvas
        ref={canvasRef}
        className="force-graph-canvas"
        tabIndex={compact ? -1 : 0}
        aria-label={t("graph.title")}
        onKeyDown={handleKeyDown}
      />
      {tooltip && (
        <div
          className="force-graph-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <span className="force-graph-tooltip-title">{tooltip.title}</span>
          <span className="force-graph-tooltip-path">{tooltip.path}</span>
        </div>
      )}
      {contextMenu && (
        <div
          className="graph-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const path = metaRef.current[contextMenu.index]?.path;
              if (path) onOpenNote(path);
              setContextMenu(null);
            }}
          >
            {t("graph.open")}
          </button>
          <button
            type="button"
            onClick={() => {
              const path = metaRef.current[contextMenu.index]?.path;
              if (path) onOpenNote(path, { split: true });
              setContextMenu(null);
            }}
          >
            {t("graph.openInNewPane")}
          </button>
        </div>
      )}
      {!compact && (
        <GraphControls
          search={search}
          onSearchChange={setSearch}
          local={!!focusPath}
          onAnimate={startAnimation}
        />
      )}
    </div>
  );
}

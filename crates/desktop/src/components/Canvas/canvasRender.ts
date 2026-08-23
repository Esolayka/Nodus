import type { CanvasData, CanvasEdge, CanvasNode, Side } from "../../lib/canvasTypes";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface DraggingEdge {
  fromNode: string;
  fromSide: Side;
  x: number;
  y: number;
}

export type NodePreview = { kind: "image"; img: HTMLImageElement } | { kind: "text"; lines: string[] };

export interface RenderState {
  data: CanvasData;
  transform: Transform;
  selection: Set<string>;
  draggingEdge: DraggingEdge | null;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Cached loaded previews, keyed by node id — filled in asynchronously by
   * the caller as files/images resolve, then this module just draws
   * whatever's ready yet. */
  previews: Map<string, NodePreview>;
  colors: {
    bg: string;
    grid: string;
    cardBg: string;
    cardBorder: string;
    text: string;
    textMuted: string;
    accent: string;
    groupBg: string;
    groupBorder: string;
  };
}

function nodeById(nodes: CanvasNode[], id: string): CanvasNode | undefined {
  return nodes.find((n) => n.id === id);
}

function anchorPoint(node: CanvasNode, side: Side): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
    default:
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) return lines;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
    if (lines.length >= maxLines) return lines;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawGrid(ctx: CanvasRenderingContext2D, t: Transform, viewW: number, viewH: number, colors: RenderState["colors"]) {
  const gridSize = 40;
  const scaled = gridSize * t.k;
  if (scaled < 6) return; // too dense to bother at low zoom
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.fillStyle = colors.grid;
  const offsetX = ((t.x % scaled) + scaled) % scaled;
  const offsetY = ((t.y % scaled) + scaled) % scaled;
  for (let x = offsetX; x < viewW; x += scaled) {
    for (let y = offsetY; y < viewH; y += scaled) {
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }
  ctx.restore();
}

function drawGroup(ctx: CanvasRenderingContext2D, node: CanvasNode, selected: boolean, colors: RenderState["colors"]) {
  if (node.type !== "group") return;
  ctx.fillStyle = colors.groupBg;
  ctx.strokeStyle = selected ? colors.accent : colors.groupBorder;
  ctx.lineWidth = selected ? 2 : 1;
  roundRect(ctx, node.x, node.y, node.width, node.height, 10);
  ctx.fill();
  ctx.stroke();
  if (node.label) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = "600 14px var(--font-ui, sans-serif)";
    ctx.textBaseline = "bottom";
    ctx.fillText(node.label, node.x + 8, node.y - 6);
  }
}

function drawCardFrame(ctx: CanvasRenderingContext2D, node: CanvasNode, selected: boolean, colors: RenderState["colors"]) {
  ctx.fillStyle = node.color ? node.color : colors.cardBg;
  ctx.strokeStyle = selected ? colors.accent : colors.cardBorder;
  ctx.lineWidth = selected ? 2.5 : 1;
  roundRect(ctx, node.x, node.y, node.width, node.height, 8);
  ctx.fill();
  ctx.stroke();
}

function drawNode(ctx: CanvasRenderingContext2D, node: CanvasNode, selected: boolean, preview: NodePreview | undefined, colors: RenderState["colors"]) {
  if (node.type === "group") return;
  drawCardFrame(ctx, node, selected, colors);

  ctx.save();
  roundRect(ctx, node.x + 1, node.y + 1, node.width - 2, node.height - 2, 7);
  ctx.clip();

  const pad = 10;
  if (node.type === "text") {
    ctx.fillStyle = colors.text;
    ctx.font = "13px var(--font-ui, sans-serif)";
    ctx.textBaseline = "top";
    const lineHeight = 18;
    const maxLines = Math.floor((node.height - pad * 2) / lineHeight);
    const lines = wrapText(ctx, node.text || "", node.width - pad * 2, Math.max(1, maxLines));
    lines.forEach((line, i) => ctx.fillText(line, node.x + pad, node.y + pad + i * lineHeight));
  } else if (node.type === "link") {
    ctx.fillStyle = colors.textMuted;
    ctx.font = "italic 12px var(--font-ui, sans-serif)";
    ctx.textBaseline = "top";
    ctx.fillText("🔗", node.x + pad, node.y + pad);
    ctx.fillStyle = colors.text;
    ctx.font = "12px var(--font-ui, sans-serif)";
    const lines = wrapText(ctx, node.url, node.width - pad * 2, 4);
    lines.forEach((line, i) => ctx.fillText(line, node.x + pad, node.y + pad + 20 + i * 16));
  } else if (node.type === "file") {
    if (preview?.kind === "image") {
      const img = preview.img;
      const scale = Math.min(node.width / img.width, node.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, node.x + (node.width - w) / 2, node.y + (node.height - h) / 2, w, h);
    } else if (preview?.kind === "text") {
      ctx.fillStyle = colors.textMuted;
      ctx.font = "11px var(--font-mono, monospace)";
      ctx.textBaseline = "top";
      const lineHeight = 14;
      preview.lines.forEach((line, i) => ctx.fillText(line, node.x + pad, node.y + pad + i * lineHeight));
    } else {
      ctx.fillStyle = colors.textMuted;
      ctx.font = "12px var(--font-ui, sans-serif)";
      ctx.textBaseline = "top";
      ctx.fillText(node.file.split("/").pop() ?? node.file, node.x + pad, node.y + pad);
    }
  }
  ctx.restore();

  // Filename label for file cards (small, bottom-left).
  if (node.type === "file") {
    ctx.fillStyle = colors.textMuted;
    ctx.font = "10px var(--font-ui, sans-serif)";
    ctx.textBaseline = "bottom";
    ctx.fillText(node.file.split("/").pop() ?? node.file, node.x + 6, node.y + node.height - 4);
  }
}

function drawBezierEdge(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, fromSide: Side, toSide: Side | null, color: string) {
  const bend = (side: Side, p: { x: number; y: number }, dist: number) => {
    switch (side) {
      case "top":
        return { x: p.x, y: p.y - dist };
      case "bottom":
        return { x: p.x, y: p.y + dist };
      case "left":
        return { x: p.x - dist, y: p.y };
      case "right":
      default:
        return { x: p.x + dist, y: p.y };
    }
  };
  const dist = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 3);
  const c1 = bend(fromSide, from, dist);
  const c2 = toSide ? bend(toSide, to, dist) : to;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
  ctx.stroke();

  // Arrowhead at the destination end.
  const angle = Math.atan2(to.y - c2.y, to.x - c2.x);
  const size = 8;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawEdge(ctx: CanvasRenderingContext2D, edge: CanvasEdge, nodes: CanvasNode[], colors: RenderState["colors"]) {
  const from = nodeById(nodes, edge.fromNode);
  const to = nodeById(nodes, edge.toNode);
  if (!from || !to) return;
  const fromSide = edge.fromSide ?? "right";
  const toSide = edge.toSide ?? "left";
  const fromPoint = anchorPoint(from, fromSide);
  const toPoint = anchorPoint(to, toSide);
  drawBezierEdge(ctx, fromPoint, toPoint, fromSide, toSide, edge.color || colors.textMuted);

  if (edge.label) {
    const midX = (fromPoint.x + toPoint.x) / 2;
    const midY = (fromPoint.y + toPoint.y) / 2;
    ctx.fillStyle = colors.bg;
    ctx.font = "11px var(--font-ui, sans-serif)";
    const w = ctx.measureText(edge.label).width;
    ctx.fillRect(midX - w / 2 - 4, midY - 9, w + 8, 18);
    ctx.fillStyle = colors.text;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(edge.label, midX, midY);
    ctx.textAlign = "left";
  }
}

export function render(canvas: HTMLCanvasElement, state: RenderState): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;
  if (canvas.width !== viewW * dpr || canvas.height !== viewH * dpr) {
    canvas.width = viewW * dpr;
    canvas.height = viewH * dpr;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawGrid(ctx, state.transform, viewW, viewH, state.colors);

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(state.transform.x, state.transform.y);
  ctx.scale(state.transform.k, state.transform.k);

  for (const node of state.data.nodes) {
    if (node.type === "group") drawGroup(ctx, node, state.selection.has(node.id), state.colors);
  }
  for (const edge of state.data.edges) {
    drawEdge(ctx, edge, state.data.nodes, state.colors);
  }
  if (state.draggingEdge) {
    const from = nodeById(state.data.nodes, state.draggingEdge.fromNode);
    if (from) {
      const fromPoint = anchorPoint(from, state.draggingEdge.fromSide);
      drawBezierEdge(ctx, fromPoint, { x: state.draggingEdge.x, y: state.draggingEdge.y }, state.draggingEdge.fromSide, null, state.colors.accent);
    }
  }
  for (const node of state.data.nodes) {
    if (node.type !== "group") drawNode(ctx, node, state.selection.has(node.id), state.previews.get(node.id), state.colors);
  }

  if (state.marquee) {
    const { x0, y0, x1, y1 } = state.marquee;
    ctx.fillStyle = "rgba(127,109,242,0.12)";
    ctx.strokeStyle = state.colors.accent;
    ctx.lineWidth = 1;
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  ctx.restore();
}

export function screenToWorld(t: Transform, x: number, y: number): { x: number; y: number } {
  return { x: (x - t.x) / t.k, y: (y - t.y) / t.k };
}

export { anchorPoint };

import type { CanvasData, CanvasEdge, CanvasNode, EndStyle, Side } from "../../lib/canvasTypes";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DraggingEdge {
  fromNode: string;
  fromSide: Side;
  x: number;
  y: number;
}

export type NodePreview = { kind: "image"; img: HTMLImageElement } | { kind: "text"; lines: string[] };

export interface CanvasColors {
  bg: string;
  grid: string;
  cardBg: string;
  cardBorder: string;
  text: string;
  textMuted: string;
  accent: string;
  groupBg: string;
  groupBorder: string;
}

export interface RenderState {
  data: CanvasData;
  transform: Transform;
  selection: Set<string>;
  selectedEdges: Set<string>;
  draggingEdge: DraggingEdge | null;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  previews: Map<string, NodePreview>;
  colors: CanvasColors;
}

export interface EdgeGeometry {
  from: Point;
  to: Point;
  c1: Point;
  c2: Point;
}

const PRESET_COLORS: Record<string, { solid: string; tint: string }> = {
  "1": { solid: "#e66a6a", tint: "rgba(230, 106, 106, 0.18)" },
  "2": { solid: "#e89b5b", tint: "rgba(232, 155, 91, 0.18)" },
  "3": { solid: "#d8bf55", tint: "rgba(216, 191, 85, 0.18)" },
  "4": { solid: "#70b77e", tint: "rgba(112, 183, 126, 0.18)" },
  "5": { solid: "#55b7c4", tint: "rgba(85, 183, 196, 0.18)" },
  "6": { solid: "#9a7be0", tint: "rgba(154, 123, 224, 0.18)" },
};

export function resolveCanvasColor(value: string | undefined, fallback: string, tint = false): string {
  if (!value) return fallback;
  const preset = PRESET_COLORS[value];
  return preset ? (tint ? preset.tint : preset.solid) : value;
}

function nodeById(nodes: CanvasNode[], id: string): CanvasNode | undefined {
  return nodes.find((node) => node.id === id);
}

export function anchorPoint(node: CanvasNode, side: Side): Point {
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

function controlPoint(side: Side, point: Point, distance: number): Point {
  switch (side) {
    case "top":
      return { x: point.x, y: point.y - distance };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "left":
      return { x: point.x - distance, y: point.y };
    case "right":
    default:
      return { x: point.x + distance, y: point.y };
  }
}

export function getEdgeGeometry(edge: CanvasEdge, nodes: CanvasNode[]): EdgeGeometry | null {
  const fromNode = nodeById(nodes, edge.fromNode);
  const toNode = nodeById(nodes, edge.toNode);
  if (!fromNode || !toNode) return null;
  const fromSide = edge.fromSide ?? "right";
  const toSide = edge.toSide ?? "left";
  const from = anchorPoint(fromNode, fromSide);
  const to = anchorPoint(toNode, toSide);
  const distance = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 3);
  return {
    from,
    to,
    c1: controlPoint(fromSide, from, distance),
    c2: controlPoint(toSide, to, distance),
  };
}

export function pointOnBezier(geometry: EdgeGeometry, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * geometry.from.x + 3 * u ** 2 * t * geometry.c1.x + 3 * u * t ** 2 * geometry.c2.x + t ** 3 * geometry.to.x,
    y: u ** 3 * geometry.from.y + 3 * u ** 2 * t * geometry.c1.y + 3 * u * t ** 2 * geometry.c2.y + t ** 3 * geometry.to.y,
  };
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function distanceToEdge(point: Point, geometry: EdgeGeometry): number {
  let previous = geometry.from;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index <= 32; index += 1) {
    const current = pointOnBezier(geometry, index / 32);
    best = Math.min(best, distanceToSegment(point, previous, current));
    previous = current;
  }
  return best;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawGrid(ctx: CanvasRenderingContext2D, transform: Transform, viewWidth: number, viewHeight: number, colors: CanvasColors) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  const gridSize = 40;
  const scaled = gridSize * transform.k;
  if (scaled < 6) return;
  const offsetX = ((transform.x % scaled) + scaled) % scaled;
  const offsetY = ((transform.y % scaled) + scaled) % scaled;
  ctx.fillStyle = colors.grid;
  for (let x = offsetX; x < viewWidth; x += scaled) {
    for (let y = offsetY; y < viewHeight; y += scaled) {
      ctx.beginPath();
      ctx.arc(x, y, 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "");
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      result.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  result.push(line);
  return result;
}

function drawMarkdownText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number, colors: CanvasColors) {
  const padding = 12;
  let cursorY = y + padding;
  const bottom = y + height - padding;
  ctx.textBaseline = "top";
  for (const rawLine of text.split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(rawLine);
    const task = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(rawLine);
    const bullet = /^[-*+]\s+(.*)$/.exec(rawLine);
    const numbered = /^(\d+\.)\s+(.*)$/.exec(rawLine);
    const quote = /^>\s?(.*)$/.exec(rawLine);
    const level = heading?.[1].length ?? 0;
    const fontSize = level ? Math.max(14, 21 - level * 1.5) : 13;
    const prefix = task ? (task[1].toLowerCase() === "x" ? "☑ " : "☐ ") : bullet ? "• " : numbered ? `${numbered[1]} ` : quote ? "│ " : "";
    const content = cleanMarkdown(heading?.[2] ?? task?.[2] ?? bullet?.[1] ?? numbered?.[2] ?? quote?.[1] ?? rawLine);
    ctx.font = `${level ? 650 : 400} ${fontSize}px var(--font-ui, sans-serif)`;
    ctx.fillStyle = quote ? colors.textMuted : colors.text;
    const lineHeight = Math.ceil(fontSize * 1.45);
    const wrapped = wrapLine(ctx, `${prefix}${content}`, width - padding * 2);
    for (const line of wrapped) {
      if (cursorY + lineHeight > bottom) return;
      ctx.fillText(line, x + padding, cursorY);
      cursorY += lineHeight;
    }
    if (!rawLine) cursorY += Math.round(lineHeight / 2);
  }
}

function drawGroup(ctx: CanvasRenderingContext2D, node: CanvasNode, selected: boolean, preview: NodePreview | undefined, colors: CanvasColors, scale: number) {
  if (node.type !== "group") return;
  ctx.fillStyle = resolveCanvasColor(node.color, colors.groupBg, true);
  roundRect(ctx, node.x, node.y, node.width, node.height, 10 / scale);
  ctx.fill();
  if (preview?.kind === "image") {
    ctx.save();
    roundRect(ctx, node.x, node.y, node.width, node.height, 10 / scale);
    ctx.clip();
    const image = preview.img;
    if (node.backgroundStyle === "repeat") {
      const pattern = ctx.createPattern(image, "repeat");
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(node.x, node.y, node.width, node.height);
      }
    } else {
      const ratio = node.backgroundStyle === "cover"
        ? Math.max(node.width / image.width, node.height / image.height)
        : Math.min(node.width / image.width, node.height / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      ctx.drawImage(image, node.x + (node.width - width) / 2, node.y + (node.height - height) / 2, width, height);
    }
    ctx.restore();
  }
  ctx.strokeStyle = selected ? colors.accent : resolveCanvasColor(node.color, colors.groupBorder);
  ctx.lineWidth = (selected ? 2 : 1) / scale;
  roundRect(ctx, node.x, node.y, node.width, node.height, 10 / scale);
  ctx.stroke();
  if (node.label) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = "600 14px var(--font-ui, sans-serif)";
    ctx.textBaseline = "bottom";
    ctx.fillText(node.label, node.x + 8 / scale, node.y - 6 / scale);
  }
}

function drawCardFrame(ctx: CanvasRenderingContext2D, node: CanvasNode, selected: boolean, colors: CanvasColors, scale: number) {
  ctx.fillStyle = resolveCanvasColor(node.color, colors.cardBg, true);
  ctx.strokeStyle = selected ? colors.accent : resolveCanvasColor(node.color, colors.cardBorder);
  ctx.lineWidth = (selected ? 2.5 : 1) / scale;
  roundRect(ctx, node.x, node.y, node.width, node.height, 8 / scale);
  ctx.fill();
  ctx.stroke();
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function drawNode(ctx: CanvasRenderingContext2D, node: CanvasNode, selected: boolean, preview: NodePreview | undefined, colors: CanvasColors, scale: number) {
  if (node.type === "group") return;
  drawCardFrame(ctx, node, selected, colors, scale);
  ctx.save();
  roundRect(ctx, node.x + 1 / scale, node.y + 1 / scale, node.width - 2 / scale, node.height - 2 / scale, 7 / scale);
  ctx.clip();

  const padding = 12;
  if (node.type === "text") {
    drawMarkdownText(ctx, node.text || "", node.x, node.y, node.width, node.height, colors);
  } else if (node.type === "link") {
    let host = node.url;
    try {
      host = new URL(node.url).hostname.replace(/^www\./, "");
    } catch {
      // Keep the original text for non-standard URLs.
    }
    ctx.fillStyle = colors.text;
    ctx.font = "600 15px var(--font-ui, sans-serif)";
    ctx.textBaseline = "top";
    ctx.fillText(host, node.x + padding, node.y + padding);
    ctx.fillStyle = colors.textMuted;
    ctx.font = "12px var(--font-ui, sans-serif)";
    wrapLine(ctx, node.url, node.width - padding * 2).slice(0, 4).forEach((line, index) => {
      ctx.fillText(line, node.x + padding, node.y + padding + 28 + index * 17);
    });
  } else if (node.type === "file") {
    if (preview?.kind === "image") {
      const image = preview.img;
      const scaleToFit = Math.min(node.width / image.width, node.height / image.height);
      const width = image.width * scaleToFit;
      const height = image.height * scaleToFit;
      ctx.drawImage(image, node.x + (node.width - width) / 2, node.y + (node.height - height) / 2, width, height);
    } else {
      ctx.fillStyle = colors.text;
      ctx.font = "600 14px var(--font-ui, sans-serif)";
      ctx.textBaseline = "top";
      ctx.fillText(fileName(node.file), node.x + padding, node.y + padding);
      ctx.strokeStyle = colors.cardBorder;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.moveTo(node.x + padding, node.y + 38);
      ctx.lineTo(node.x + node.width - padding, node.y + 38);
      ctx.stroke();
      if (preview?.kind === "text") {
        ctx.fillStyle = colors.textMuted;
        ctx.font = "12px var(--font-ui, sans-serif)";
        ctx.textBaseline = "top";
        const excerpt = cleanMarkdown(preview.lines.join("\n"));
        const lines = excerpt.split("\n").flatMap((line) => wrapLine(ctx, line, node.width - padding * 2));
        const maxLines = Math.max(1, Math.floor((node.height - 58) / 17));
        lines.slice(0, maxLines).forEach((line, index) => ctx.fillText(line, node.x + padding, node.y + 48 + index * 17));
      }
    }
  }
  ctx.restore();

  if (node.type === "file" && preview?.kind === "image") {
    const label = fileName(node.file);
    ctx.font = "11px var(--font-ui, sans-serif)";
    const width = Math.min(node.width - 12, ctx.measureText(label).width + 12);
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    roundRect(ctx, node.x + 6, node.y + node.height - 25, width, 19, 4);
    ctx.fill();
    ctx.fillStyle = "#f0f0f0";
    ctx.textBaseline = "middle";
    ctx.fillText(label, node.x + 12, node.y + node.height - 15.5);
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, point: Point, angle: number, color: string, scale: number) {
  const size = 8 / scale;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(point.x - size * Math.cos(angle - Math.PI / 6), point.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(point.x - size * Math.cos(angle + Math.PI / 6), point.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBezier(ctx: CanvasRenderingContext2D, geometry: EdgeGeometry, color: string, scale: number, width: number, fromEnd: EndStyle = "none", toEnd: EndStyle = "arrow") {
  ctx.strokeStyle = color;
  ctx.lineWidth = width / scale;
  ctx.beginPath();
  ctx.moveTo(geometry.from.x, geometry.from.y);
  ctx.bezierCurveTo(geometry.c1.x, geometry.c1.y, geometry.c2.x, geometry.c2.y, geometry.to.x, geometry.to.y);
  ctx.stroke();
  if (fromEnd === "arrow") {
    drawArrow(ctx, geometry.from, Math.atan2(geometry.from.y - geometry.c1.y, geometry.from.x - geometry.c1.x), color, scale);
  }
  if (toEnd === "arrow") {
    drawArrow(ctx, geometry.to, Math.atan2(geometry.to.y - geometry.c2.y, geometry.to.x - geometry.c2.x), color, scale);
  }
}

function drawEdge(ctx: CanvasRenderingContext2D, edge: CanvasEdge, nodes: CanvasNode[], selected: boolean, colors: CanvasColors, scale: number) {
  const geometry = getEdgeGeometry(edge, nodes);
  if (!geometry) return;
  const color = selected ? colors.accent : resolveCanvasColor(edge.color, colors.textMuted);
  drawBezier(ctx, geometry, color, scale, selected ? 3 : 2, edge.fromEnd ?? "none", edge.toEnd ?? "arrow");

  if (edge.label) {
    const midpoint = pointOnBezier(geometry, 0.5);
    ctx.font = "11px var(--font-ui, sans-serif)";
    const width = ctx.measureText(edge.label).width;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(midpoint.x - width / 2 - 5 / scale, midpoint.y - 10 / scale, width + 10 / scale, 20 / scale);
    ctx.fillStyle = colors.text;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(edge.label, midpoint.x, midpoint.y);
    ctx.textAlign = "left";
  }
  if (selected) {
    ctx.fillStyle = colors.accent;
    for (const point of [geometry.from, geometry.to]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4 / scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawNodeControls(ctx: CanvasRenderingContext2D, node: CanvasNode, colors: CanvasColors, scale: number, showResize: boolean) {
  const anchorRadius = 4.5 / scale;
  if (node.type !== "group") {
    for (const side of ["top", "right", "bottom", "left"] as Side[]) {
      const point = anchorPoint(node, side);
      ctx.beginPath();
      ctx.arc(point.x, point.y, anchorRadius, 0, Math.PI * 2);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = colors.accent;
      ctx.stroke();
    }
  }
  if (!showResize) return;
  const size = 8 / scale;
  const corners: Point[] = [
    { x: node.x, y: node.y },
    { x: node.x + node.width, y: node.y },
    { x: node.x, y: node.y + node.height },
    { x: node.x + node.width, y: node.y + node.height },
  ];
  for (const point of corners) {
    ctx.fillStyle = colors.bg;
    ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
  }
}

export function render(canvas: HTMLCanvasElement, state: RenderState): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const viewWidth = canvas.clientWidth;
  const viewHeight = canvas.clientHeight;
  const pixelWidth = Math.max(1, Math.round(viewWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(viewHeight * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGrid(ctx, state.transform, viewWidth, viewHeight, state.colors);
  ctx.save();
  ctx.translate(state.transform.x, state.transform.y);
  ctx.scale(state.transform.k, state.transform.k);

  for (const node of state.data.nodes) {
    if (node.type === "group") drawGroup(ctx, node, state.selection.has(node.id), state.previews.get(node.id), state.colors, state.transform.k);
  }
  for (const edge of state.data.edges) {
    drawEdge(ctx, edge, state.data.nodes, state.selectedEdges.has(edge.id), state.colors, state.transform.k);
  }
  if (state.draggingEdge) {
    const fromNode = nodeById(state.data.nodes, state.draggingEdge.fromNode);
    if (fromNode) {
      const from = anchorPoint(fromNode, state.draggingEdge.fromSide);
      const to = { x: state.draggingEdge.x, y: state.draggingEdge.y };
      const distance = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 3);
      const geometry = { from, to, c1: controlPoint(state.draggingEdge.fromSide, from, distance), c2: to };
      drawBezier(ctx, geometry, state.colors.accent, state.transform.k, 2, "none", "arrow");
    }
  }
  for (const node of state.data.nodes) {
    if (node.type !== "group") {
      drawNode(ctx, node, state.selection.has(node.id), state.previews.get(node.id), state.colors, state.transform.k);
    }
  }

  const singleSelection = state.selection.size === 1;
  for (const node of state.data.nodes) {
    if (state.selection.has(node.id)) drawNodeControls(ctx, node, state.colors, state.transform.k, singleSelection);
  }

  if (state.marquee) {
    const { x0, y0, x1, y1 } = state.marquee;
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const width = Math.abs(x1 - x0);
    const height = Math.abs(y1 - y0);
    ctx.fillStyle = "rgba(127,109,242,0.12)";
    ctx.strokeStyle = state.colors.accent;
    ctx.lineWidth = 1 / state.transform.k;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
  }

  ctx.restore();
}

export function screenToWorld(transform: Transform, x: number, y: number): Point {
  return { x: (x - transform.x) / transform.k, y: (y - transform.y) / transform.k };
}

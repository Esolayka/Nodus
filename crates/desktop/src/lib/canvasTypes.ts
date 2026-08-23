/** The open JSON Canvas format (https://jsoncanvas.org/), which is what
 * Obsidian's `.canvas` files use — matching it exactly (rather than
 * inventing our own shape) is what lets a canvas round-trip between the two
 * apps unmodified. */

export type NodeType = "text" | "file" | "link" | "group";

interface BaseNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface TextNode extends BaseNode {
  type: "text";
  text: string;
}

export interface FileNode extends BaseNode {
  type: "file";
  file: string;
  /** e.g. `#page=3` for a PDF, or `#Heading` for a note. */
  subpath?: string;
}

export interface LinkNode extends BaseNode {
  type: "link";
  url: string;
}

export interface GroupNode extends BaseNode {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export type Side = "top" | "right" | "bottom" | "left";
export type EndStyle = "none" | "arrow";

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: EndStyle;
  toNode: string;
  toSide?: Side;
  toEnd?: EndStyle;
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function emptyCanvas(): CanvasData {
  return { nodes: [], edges: [] };
}

export function parseCanvas(raw: string): CanvasData {
  return parseCanvasWithError(raw).data;
}

export function parseCanvasWithError(raw: string): { data: CanvasData; error: string | null } {
  if (!raw.trim()) return { data: emptyCanvas(), error: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: emptyCanvas(), error: "Canvas root must be a JSON object" };
    }
    if (parsed.nodes != null && !Array.isArray(parsed.nodes)) {
      return { data: emptyCanvas(), error: "Canvas 'nodes' must be an array" };
    }
    if (parsed.edges != null && !Array.isArray(parsed.edges)) {
      return { data: emptyCanvas(), error: "Canvas 'edges' must be an array" };
    }
    const nodes = (parsed.nodes ?? []) as unknown[];
    const edges = (parsed.edges ?? []) as unknown[];
    const sides = new Set(["top", "right", "bottom", "left"]);
    const ends = new Set(["none", "arrow"]);
    const nodeTypes = new Set(["text", "file", "link", "group"]);
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node == null || typeof node !== "object" || Array.isArray(node)) {
        return { data: emptyCanvas(), error: `Canvas node ${index + 1} must be an object` };
      }
      const value = node as Record<string, unknown>;
      const geometry = [value.x, value.y, value.width, value.height];
      if (typeof value.id !== "string" || !nodeTypes.has(String(value.type)) || geometry.some((part) => typeof part !== "number" || !Number.isFinite(part))) {
        return { data: emptyCanvas(), error: `Canvas node ${index + 1} is missing a valid id, type, or geometry` };
      }
      if ((value as { width: number }).width <= 0 || (value as { height: number }).height <= 0) {
        return { data: emptyCanvas(), error: `Canvas node ${index + 1} must have a positive width and height` };
      }
      if (value.type === "text" && typeof value.text !== "string") return { data: emptyCanvas(), error: `Text node ${index + 1} is missing text` };
      if (value.type === "file" && typeof value.file !== "string") return { data: emptyCanvas(), error: `File node ${index + 1} is missing a file path` };
      if (value.type === "link" && typeof value.url !== "string") return { data: emptyCanvas(), error: `Link node ${index + 1} is missing a URL` };
    }
    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index];
      if (edge == null || typeof edge !== "object" || Array.isArray(edge)) {
        return { data: emptyCanvas(), error: `Canvas edge ${index + 1} must be an object` };
      }
      const value = edge as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.fromNode !== "string" || typeof value.toNode !== "string") {
        return { data: emptyCanvas(), error: `Canvas edge ${index + 1} is missing an id or endpoint` };
      }
      if ((value.fromSide != null && !sides.has(String(value.fromSide))) || (value.toSide != null && !sides.has(String(value.toSide)))) {
        return { data: emptyCanvas(), error: `Canvas edge ${index + 1} has an invalid side` };
      }
      if ((value.fromEnd != null && !ends.has(String(value.fromEnd))) || (value.toEnd != null && !ends.has(String(value.toEnd)))) {
        return { data: emptyCanvas(), error: `Canvas edge ${index + 1} has an invalid end style` };
      }
    }
    return { data: { nodes: nodes as CanvasNode[], edges: edges as CanvasEdge[] }, error: null };
  } catch (error) {
    return { data: emptyCanvas(), error: error instanceof Error ? error.message : String(error) };
  }
}

/** Indented JSON, so `.canvas` files merge sanely in Git. */
export function serializeCanvas(data: CanvasData): string {
  return JSON.stringify(data, null, 2);
}

export function newNodeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function isCanvasPath(path: string): boolean {
  return path.toLowerCase().endsWith(".canvas");
}

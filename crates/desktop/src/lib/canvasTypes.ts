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
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export type Side = "top" | "right" | "bottom" | "left";

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  toNode: string;
  toSide?: Side;
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
  if (!raw.trim()) return emptyCanvas();
  try {
    const parsed = JSON.parse(raw);
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return emptyCanvas();
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

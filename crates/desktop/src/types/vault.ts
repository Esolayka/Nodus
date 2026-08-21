export interface TreeNode {
  path: string;
  name: string;
  isDir: boolean;
  children: TreeNode[];
}

export type ChangeKind = "created" | "modified" | "removed";

export interface FsChange {
  kind: ChangeKind;
  path: string;
}

export interface Backlink {
  fromPath: string;
  kind: "wikilink" | "embed";
  context: string;
  line: number;
}

export interface Mention {
  fromPath: string;
  context: string;
  start: number;
  end: number;
}

export interface HeadingEntry {
  level: number;
  text: string;
  position: number;
}

export interface GraphNode {
  path: string;
  title: string;
}

export interface GraphLink {
  fromPath: string;
  toPath: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface SearchLineMatch {
  line: number;
  text: string;
  ranges: [number, number][];
}

export interface SearchFileResult {
  path: string;
  matches: SearchLineMatch[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ReplaceLineMatch {
  line: number;
  before: string;
  after: string;
}

export interface ReplaceFilePreview {
  path: string;
  matches: ReplaceLineMatch[];
}

export interface ReplaceSelection {
  path: string;
  line: number;
}

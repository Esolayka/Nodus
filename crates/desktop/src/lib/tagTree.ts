import type { TagCount } from "../types/vault";

export interface TagTreeNode {
  name: string;
  /** Full slash-joined path, e.g. `"project/nodus"` — what a `tag:` search
   * and rename both operate on. */
  fullPath: string;
  /** `null` for a pure namespace node with no notes tagged at exactly this
   * path (only children) — e.g. `"project"` when only `#project/nodus` is
   * ever used, never a bare `#project`. */
  count: number | null;
  children: TagTreeNode[];
}

interface Builder {
  name: string;
  fullPath: string;
  count: number | null;
  children: Map<string, Builder>;
}

function finalize(builder: Builder): TagTreeNode {
  const children = [...builder.children.values()]
    .map(finalize)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { name: builder.name, fullPath: builder.fullPath, count: builder.count, children };
}

export function buildTagTree(counts: TagCount[]): TagTreeNode[] {
  const root = new Map<string, Builder>();
  for (const { tag, count } of counts) {
    const segments = tag.split("/");
    let level = root;
    let pathSoFar: string[] = [];
    let node: Builder | undefined;
    for (let i = 0; i < segments.length; i++) {
      pathSoFar = [...pathSoFar, segments[i]];
      const fullPath = pathSoFar.join("/");
      node = level.get(segments[i]);
      if (!node) {
        node = { name: segments[i], fullPath, count: null, children: new Map() };
        level.set(segments[i], node);
      }
      if (i === segments.length - 1) {
        node.count = count;
      }
      level = node.children;
    }
  }
  return [...root.values()].map(finalize).sort((a, b) => a.name.localeCompare(b.name));
}

/** Re-orders every level of the tree (siblings only — the hierarchy itself
 * stays intact either way) by name or by descending count. */
export function sortTree(nodes: TagTreeNode[], mode: "alpha" | "frequency"): TagTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (mode === "frequency") {
      const diff = (b.count ?? 0) - (a.count ?? 0);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
  return sorted.map((node) => ({ ...node, children: sortTree(node.children, mode) }));
}

/** Flattens the tree back to a list for frequency-sorted display — namespace
 * nodes (no direct count) are excluded, matching what actually gets listed
 * with a number next to it. */
export function flattenCounted(nodes: TagTreeNode[]): TagTreeNode[] {
  const out: TagTreeNode[] = [];
  const walk = (list: TagTreeNode[]) => {
    for (const node of list) {
      if (node.count != null) out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

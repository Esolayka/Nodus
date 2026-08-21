import type { TreeNode } from "../types/vault";

/** Mirrors `resolve_target_locked` in `crates/core/src/index.rs`, kept
 * client-side (rather than round-tripping to Rust) so wikilink rendering and
 * autocomplete stay synchronous in the editor's render loop. */
export interface NoteIndex {
  /** lowercased basename (no `.md`) -> candidate paths, alphabetically sorted */
  byBasename: Map<string, string[]>;
  allPaths: Set<string>;
  /** all note paths with their basename, for autocomplete */
  notes: { path: string; title: string }[];
}

function titleOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

export function buildNoteIndex(tree: TreeNode | null): NoteIndex {
  const byBasename = new Map<string, string[]>();
  const allPaths = new Set<string>();
  const notes: { path: string; title: string }[] = [];

  function walk(node: TreeNode) {
    if (!node.isDir && node.path.toLowerCase().endsWith(".md")) {
      allPaths.add(node.path);
      const title = titleOf(node.path);
      notes.push({ path: node.path, title });
      const key = title.toLowerCase();
      const list = byBasename.get(key) ?? [];
      list.push(node.path);
      list.sort();
      byBasename.set(key, list);
    }
    for (const child of node.children) walk(child);
  }
  if (tree) walk(tree);
  notes.sort((a, b) => a.title.localeCompare(b.title));

  return { byBasename, allPaths, notes };
}

export function resolveWikilinkTarget(index: NoteIndex, target: string): string | null {
  const stem = target.endsWith(".md") ? target.slice(0, -3) : target;

  if (stem.includes("/")) {
    const candidate = `${stem}.md`;
    return index.allPaths.has(candidate) ? candidate : null;
  }

  const matches = index.byBasename.get(stem.toLowerCase());
  return matches && matches.length > 0 ? matches[0] : null;
}

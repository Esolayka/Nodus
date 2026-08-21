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

function dirComponents(path: string): string[] {
  const parts = path.split("/");
  parts.pop(); // drop the filename itself
  return parts;
}

/** Folder-distance between two notes: directory levels up from `from` plus
 * back down to `candidate`, past their common ancestor. Mirrors
 * `tree_distance` in `crates/core/src/index.rs` exactly — same tie-breaking,
 * so the editor's live rendering agrees with what rename/backlinks resolve to. */
function treeDistance(fromDir: string[], candidateDir: string[]): number {
  let common = 0;
  while (common < fromDir.length && common < candidateDir.length && fromDir[common] === candidateDir[common]) {
    common++;
  }
  return fromDir.length - common + (candidateDir.length - common);
}

/** Resolves a raw `[[target]]` string from `fromPath`'s point of view —
 * when several notes share a basename, the closest one by folder wins
 * (ties broken alphabetically), matching the Rust index's resolution. */
export function resolveWikilinkTarget(
  index: NoteIndex,
  target: string,
  fromPath: string,
): string | null {
  const stem = target.endsWith(".md") ? target.slice(0, -3) : target;

  if (stem.includes("/")) {
    const candidate = `${stem}.md`;
    return index.allPaths.has(candidate) ? candidate : null;
  }

  const matches = index.byBasename.get(stem.toLowerCase());
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const fromDir = dirComponents(fromPath);
  let best = matches[0];
  let bestDistance = treeDistance(fromDir, dirComponents(best));
  for (const candidate of matches.slice(1)) {
    const distance = treeDistance(fromDir, dirComponents(candidate));
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

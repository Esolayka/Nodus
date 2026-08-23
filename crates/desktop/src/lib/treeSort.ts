import type { TreeNode } from "../types/vault";

/** Folders before files, then alphabetical — reversed end to end (not just
 * the alphabetical part) when sort order is toggled, so folders still
 * group together either way. */
export function sortChildren(children: TreeNode[], reversed: boolean): TreeNode[] {
  const sorted = [...children].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return reversed ? sorted.reverse() : sorted;
}

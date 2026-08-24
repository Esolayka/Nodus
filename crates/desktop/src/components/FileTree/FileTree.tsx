import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { previewRename } from "../../api/vault";
import { useSettingsStore } from "../../store/settingsStore";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { TreeNode } from "../../types/vault";
import { FileTreeNode } from "./FileTreeNode";
import { RenameConfirmDialog } from "./RenameConfirmDialog";
import { displayName } from "../../lib/displayName";
import { defaultNoteName } from "../../lib/noteNaming";
import { sortChildren } from "../../lib/treeSort";
import "./FileTree.css";

interface PendingRename {
  oldPath: string;
  newPath: string;
  affected: string[];
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function withNewName(path: string, name: string): string {
  const parent = parentOf(path);
  return parent ? `${parent}/${name}` : name;
}

function findNode(node: TreeNode, path: string): TreeNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function sortedTree(nodes: TreeNode[], reversed: boolean): TreeNode[] {
  return sortChildren(nodes, reversed).map((node) =>
    node.isDir ? { ...node, children: sortedTree(node.children, reversed) } : node,
  );
}

function activeNotePath(): string | null {
  const state = useWorkspaceStore.getState();
  const activePaneId = state.activePaneId || state.panes[0]?.id;
  const pane = state.panes.find((candidate) => candidate.id === activePaneId);
  return pane?.view === null ? pane.activePath : null;
}

export function FileTree() {
  const { t } = useTranslation();
  const tree = useVaultStore((s) => s.tree);
  const createFile = useVaultStore((s) => s.createFile);
  const createFolder = useVaultStore((s) => s.createFolder);
  const renameEntry = useVaultStore((s) => s.renameEntry);
  const deleteEntry = useVaultStore((s) => s.deleteEntry);
  const handleRenamed = useWorkspaceStore((s) => s.handleRenamed);
  const closePath = useWorkspaceStore((s) => s.closePath);
  const openNote = useWorkspaceStore((s) => s.openNote);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortReversed, setSortReversed] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);
  // Guards against double-committing: pressing Enter unmounts the rename
  // input, and the resulting native blur fires onBlur's commit again.
  const renameCommittedRef = useRef(false);
  const treeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    const onToggleSort = () => setSortReversed((r) => !r);
    const onCollapseAll = () => setExpanded(new Set());
    document.addEventListener("nodus:toggleSort", onToggleSort);
    document.addEventListener("nodus:collapseAll", onCollapseAll);
    return () => {
      document.removeEventListener("nodus:toggleSort", onToggleSort);
      document.removeEventListener("nodus:collapseAll", onCollapseAll);
    };
  }, []);

  useEffect(() => {
    let previousPath = activeNotePath();
    return useWorkspaceStore.subscribe(() => {
      const nextPath = activeNotePath();
      if (nextPath === previousPath) return;
      const root = treeRef.current;
      root?.querySelector(".tree-item-active")?.classList.remove("tree-item-active");
      if (root && nextPath) {
        root
          .querySelector(`[data-tree-path="${CSS.escape(nextPath)}"]`)
          ?.classList.add("tree-item-active");
      }
      previousPath = nextPath;
    });
  }, []);

  const topLevel = useMemo(() => {
    if (!tree) return [];
    // If the vault root holds nothing but a single folder, that folder is a
    // redundant wrapper. Peel every such layer, then sort the complete
    // visible tree once instead of sorting every expanded folder on every
    // active-note render.
    let rawTopLevel = tree.children;
    while (rawTopLevel.length === 1 && rawTopLevel[0].isDir) {
      rawTopLevel = rawTopLevel[0].children;
    }
    return sortedTree(rawTopLevel, sortReversed);
  }, [tree, sortReversed]);

  if (!tree) return null;

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function startRename(node: TreeNode) {
    renameCommittedRef.current = false;
    setRenamingPath(node.path);
    setRenameValue(displayName(node.path));
    setContextMenu(null);
  }

  // Notes (not folders — folders aren't themselves link targets) go through
  // a preview first: if other notes reference this one, the user confirms
  // before any link gets rewritten. Nothing referencing it means nothing to
  // confirm, so it proceeds immediately.
  async function requestRename(oldPath: string, newPath: string, isNote: boolean) {
    if (isNote) {
      const affected = await previewRename(oldPath);
      if (affected.length > 0) {
        setPendingRename({ oldPath, newPath, affected });
        return;
      }
    }
    await renameEntry(oldPath, newPath);
    handleRenamed(oldPath, newPath);
  }

  async function commitRename() {
    if (!renamingPath || renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    const originalName = renamingPath.slice(renamingPath.lastIndexOf("/") + 1);
    let name = renameValue.trim();
    setRenamingPath(null);
    if (!name) return;
    const node = tree ? findNode(tree, renamingPath) : null;
    const isNote = !!node && !node.isDir;
    if (isNote) {
      const extIdx = originalName.lastIndexOf(".");
      const extension = extIdx > 0 ? originalName.slice(extIdx) : ".md";
      if (!name.includes(".")) name = `${name}${extension}`;
    }
    const newPath = withNewName(renamingPath, name);
    if (newPath === renamingPath) return;
    await requestRename(renamingPath, newPath, isNote);
  }

  async function confirmPendingRename() {
    if (!pendingRename) return;
    const { oldPath, newPath } = pendingRename;
    setPendingRename(null);
    await renameEntry(oldPath, newPath);
    handleRenamed(oldPath, newPath);
  }

  async function handleNewFile(parentPath: string) {
    setContextMenu(null);
    if (parentPath) setExpanded((prev) => new Set(prev).add(parentPath));
    const path = await createFile(parentPath, defaultNoteName(t("fileTree.untitled")));
    await openNote(path);
  }

  async function handleNewFolder(parentPath: string) {
    setContextMenu(null);
    if (parentPath) setExpanded((prev) => new Set(prev).add(parentPath));
    await createFolder(parentPath, t("fileTree.newFolderName"));
  }

  async function handleDelete(node: TreeNode) {
    setContextMenu(null);
    const confirmDeletion =
      useSettingsStore.getState().settings.general.confirmFileDeletion;
    if (
      confirmDeletion &&
      !window.confirm(t("fileTree.confirmDelete", { name: node.name }))
    ) {
      return;
    }
    await deleteEntry(node.path);
    closePath(node.path);
  }

  async function handleDrop(draggedPath: string, targetFolderPath: string) {
    const name = draggedPath.slice(draggedPath.lastIndexOf("/") + 1);
    const newPath = targetFolderPath ? `${targetFolderPath}/${name}` : name;
    if (newPath === draggedPath) return;
    const node = tree ? findNode(tree, draggedPath) : null;
    await requestRename(draggedPath, newPath, !!node && !node.isDir);
  }

  return (
    <div
      ref={treeRef}
      className="file-tree"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const dragged = e.dataTransfer.getData("text/nodus-path");
        if (dragged) void handleDrop(dragged, "");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, node: tree });
      }}
    >
      {topLevel.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          expanded={expanded}
          renamingPath={renamingPath}
          renameValue={renameValue}
          onToggleExpand={toggleExpand}
          onOpen={(path, split) => void openNote(path, { split })}
          onContextMenu={(e, node) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, node });
          }}
          onRenameChange={setRenameValue}
          onRenameCommit={() => void commitRename()}
          onRenameCancel={() => {
            renameCommittedRef.current = true;
            setRenamingPath(null);
          }}
          onDrop={(dragged, target) => void handleDrop(dragged, target)}
        />
      ))}

      {contextMenu && (
        <div
          className="tree-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() =>
              handleNewFile(contextMenu.node.isDir ? contextMenu.node.path : parentOf(contextMenu.node.path))
            }
          >
            {t("fileTree.newNote")}
          </button>
          <button
            type="button"
            onClick={() =>
              handleNewFolder(
                contextMenu.node.isDir ? contextMenu.node.path : parentOf(contextMenu.node.path),
              )
            }
          >
            {t("fileTree.newFolder")}
          </button>
          {contextMenu.node.path !== "" && (
            <>
              <button type="button" onClick={() => startRename(contextMenu.node)}>
                {t("fileTree.rename")}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => handleDelete(contextMenu.node)}
              >
                {t("fileTree.delete")}
              </button>
            </>
          )}
        </div>
      )}

      {pendingRename && (
        <RenameConfirmDialog
          affected={pendingRename.affected}
          onConfirm={() => void confirmPendingRename()}
          onCancel={() => setPendingRename(null)}
        />
      )}
    </div>
  );
}

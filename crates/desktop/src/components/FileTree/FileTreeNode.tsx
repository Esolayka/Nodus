import type { KeyboardEvent, MouseEvent } from "react";
import type { TreeNode } from "../../types/vault";
import { isCanvasPath } from "../../lib/canvasTypes";
import { displayName } from "../../lib/displayName";
import { useWorkspaceStore } from "../../store/workspaceStore";

interface FileTreeNodeProps {
  node: TreeNode;
  expanded: Set<string>;
  renamingPath: string | null;
  renameValue: string;
  onToggleExpand: (path: string) => void;
  onOpen: (path: string, split: boolean) => void;
  onContextMenu: (e: MouseEvent, node: TreeNode) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onDrop: (draggedPath: string, targetFolderPath: string) => void;
}

export function FileTreeNode(props: FileTreeNodeProps) {
  const { node } = props;
  const workspace = useWorkspaceStore.getState();
  const activePaneId = workspace.activePaneId || workspace.panes[0]?.id;
  const activePane = workspace.panes.find(
    (candidate) => candidate.id === activePaneId,
  );
  const isActive = activePane?.view === null && activePane.activePath === node.path;
  const isExpanded = props.expanded.has(node.path);
  const isRenaming = props.renamingPath === node.path;
  const isCanvas = !node.isDir && isCanvasPath(node.path);
  const name = displayName(node.path);
  const visibleName = isCanvas ? name.slice(0, -".canvas".length) : name;

  return (
    <div className="tree-node">
      <div
        className={`tree-item${isActive ? " tree-item-active" : ""}`}
        data-tree-path={node.path}
        draggable={!isRenaming}
        onDragStart={(e) => e.dataTransfer.setData("text/nodus-path", node.path)}
        onDragOver={(e) => {
          if (node.isDir) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!node.isDir) return;
          e.preventDefault();
          const dragged = e.dataTransfer.getData("text/nodus-path");
          if (dragged && dragged !== node.path) props.onDrop(dragged, node.path);
        }}
        onClick={(e) => {
          if (node.isDir) props.onToggleExpand(node.path);
          else props.onOpen(node.path, e.altKey || e.ctrlKey || e.metaKey);
        }}
        onContextMenu={(e) => props.onContextMenu(e, node)}
      >
        {node.isDir ? (
          <span className={`tree-item-chevron${isExpanded ? " tree-item-chevron-open" : ""}`}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m6 4 4 4-4 4" />
            </svg>
          </span>
        ) : (
          <span className="tree-item-gutter" />
        )}
        {isRenaming ? (
          <input
            className="tree-item-rename-input"
            autoFocus
            value={props.renameValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => props.onRenameChange(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              // Without this, the same native keydown keeps bubbling past
              // React's handling here and can reach a dialog's own
              // document-level Enter/Escape listener that mounts moments
              // later (e.g. the rename-confirm dialog this Enter opens),
              // closing it right back on the same keypress.
              if (e.key === "Enter") {
                e.stopPropagation();
                props.onRenameCommit();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                props.onRenameCancel();
              }
            }}
            onBlur={props.onRenameCommit}
          />
        ) : (
          <>
            <span className="tree-item-name">{visibleName}</span>
            {isCanvas && <span className="tree-item-kind">CANVAS</span>}
          </>
        )}
      </div>
      {node.isDir && isExpanded && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeNode key={child.path} {...props} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

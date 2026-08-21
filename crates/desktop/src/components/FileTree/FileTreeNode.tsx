import type { KeyboardEvent, MouseEvent } from "react";
import type { TreeNode } from "../../types/vault";
import { displayName } from "../../lib/displayName";

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activePath: string | null;
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
  const { node, depth } = props;
  const isExpanded = props.expanded.has(node.path);
  const isRenaming = props.renamingPath === node.path;

  return (
    <div className="tree-node">
      <div
        className={`tree-item${node.path === props.activePath ? " tree-item-active" : ""}`}
        style={{ paddingLeft: `${depth * 17 + 12}px` }}
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
              if (e.key === "Enter") props.onRenameCommit();
              if (e.key === "Escape") props.onRenameCancel();
            }}
            onBlur={props.onRenameCommit}
          />
        ) : (
          <span className="tree-item-name">{displayName(node.path)}</span>
        )}
      </div>
      {node.isDir && isExpanded && (
        <div className="tree-children" style={{ marginLeft: `${depth * 17 + 18}px` }}>
          {node.children.map((child) => (
            <FileTreeNode key={child.path} {...props} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
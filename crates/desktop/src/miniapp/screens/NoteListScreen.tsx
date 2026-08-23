import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TreeNode } from "../../types/vault";
import { readTree } from "../sync";

function FolderRow({
  node,
  depth,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          className="note-row note-row-folder"
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className={`note-row-caret${expanded ? " note-row-caret-open" : ""}`}>
            <ChevronRight size={12} style={{ transform: expanded ? "rotate(90deg)" : "none" }} />
          </span>
          <span className="note-row-name">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => <FolderRow key={child.path} node={child} depth={depth + 1} onOpen={onOpen} />)}
      </div>
    );
  }

  if (!node.name.toLowerCase().endsWith(".md")) return null;

  return (
    <button type="button" className="note-row" style={{ paddingLeft: 12 + depth * 16 }} onClick={() => onOpen(node.path)}>
      <span className="note-row-name">{node.name.replace(/\.md$/i, "")}</span>
    </button>
  );
}

export function NoteListScreen({ onOpen }: { onOpen: (path: string) => void }) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readTree()
      .then((t) => {
        if (!cancelled) setTree(t);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="miniapp-empty">{error}</p>;
  if (!tree) return <p className="miniapp-empty">Loading…</p>;
  if (tree.children.length === 0) return <p className="miniapp-empty">No notes yet.</p>;

  return (
    <div className="note-list">
      {tree.children.map((child) => (
        <FolderRow key={child.path} node={child} depth={0} onOpen={onOpen} />
      ))}
    </div>
  );
}

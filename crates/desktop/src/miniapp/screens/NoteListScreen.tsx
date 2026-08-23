import { useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Plus } from "lucide-react";
import type { TreeNode } from "../../types/vault";
import { NewNoteSheet } from "../components/NewNoteSheet";
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
          style={{ paddingLeft: 14 + depth * 16 }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="note-row-caret">
            <ChevronRight size={14} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }} />
          </span>
          <span className="miniapp-row-icon">
            {expanded ? <FolderOpen size={17} /> : <Folder size={17} />}
          </span>
          <span className="note-row-name">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => <FolderRow key={child.path} node={child} depth={depth + 1} onOpen={onOpen} />)}
      </div>
    );
  }

  if (!node.name.toLowerCase().endsWith(".md")) return null;

  return (
    <button type="button" className="note-row" style={{ paddingLeft: 14 + depth * 16 }} onClick={() => onOpen(node.path)}>
      <span className="miniapp-row-icon">
        <FileText size={17} />
      </span>
      <span className="note-row-name">{node.name.replace(/\.md$/i, "")}</span>
    </button>
  );
}

export function NoteListScreen({ onOpen }: { onOpen: (path: string) => void }) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const existingRootNames = new Set(tree.children.filter((c) => !c.isDir).map((c) => c.name));

  return (
    <div>
      <button type="button" className="note-list-new-btn" onClick={() => setCreating(true)}>
        <span className="miniapp-row-icon">
          <Plus size={17} />
        </span>
        <span>New note</span>
      </button>
      {tree.children.length === 0 ? (
        <p className="miniapp-empty">No notes yet.</p>
      ) : (
        <div className="note-list miniapp-card">
          {tree.children.map((child) => (
            <FolderRow key={child.path} node={child} depth={0} onOpen={onOpen} />
          ))}
        </div>
      )}
      {creating && (
        <NewNoteSheet existingNames={existingRootNames} onClose={() => setCreating(false)} onCreated={(path) => onOpen(path)} />
      )}
    </div>
  );
}

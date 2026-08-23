import { useEffect, useState } from "react";
import { previewRename } from "../../api/vault";
import { displayName } from "../../lib/displayName";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { RenameConfirmDialog } from "../FileTree/RenameConfirmDialog";
import "./InlineTitle.css";

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function withNewName(path: string, name: string): string {
  const parent = parentOf(path);
  return parent ? `${parent}/${name}` : name;
}

interface PendingRename {
  oldPath: string;
  newPath: string;
  affected: string[];
}

/** Always-visible title derived from the file name — shown whether or not
 * the note has its own `# heading`, editable in place, and committing an
 * edit renames the file (through the same preview-affected-links flow as
 * the file tree's own rename, so wikilinks elsewhere get updated the same
 * way either path is used). */
export function InlineTitle({ path }: { path: string }) {
  const renameEntry = useVaultStore((s) => s.renameEntry);
  const handleRenamed = useWorkspaceStore((s) => s.handleRenamed);
  const [value, setValue] = useState(() => displayName(path));
  const [pending, setPending] = useState<PendingRename | null>(null);

  useEffect(() => {
    setValue(displayName(path));
  }, [path]);

  async function commit() {
    const name = value.trim();
    const current = displayName(path);
    if (!name || name === current) {
      setValue(current);
      return;
    }
    const parent = parentOf(path);
    const extIdx = path.lastIndexOf(".");
    const extension = extIdx > parent.length ? path.slice(extIdx) : ".md";
    const newPath = withNewName(path, `${name}${extension}`);
    if (newPath === path) return;

    const affected = await previewRename(path);
    if (affected.length > 0) {
      setPending({ oldPath: path, newPath, affected });
      return;
    }
    await renameEntry(path, newPath);
    handleRenamed(path, newPath);
  }

  async function confirmPending() {
    if (!pending) return;
    const { oldPath, newPath } = pending;
    setPending(null);
    await renameEntry(oldPath, newPath);
    handleRenamed(oldPath, newPath);
  }

  return (
    <>
      <input
        className="inline-title"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setValue(displayName(path));
            e.currentTarget.blur();
          }
        }}
        spellCheck={false}
        aria-label="Note title"
      />
      {pending && (
        <RenameConfirmDialog
          affected={pending.affected}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmPending()}
        />
      )}
    </>
  );
}

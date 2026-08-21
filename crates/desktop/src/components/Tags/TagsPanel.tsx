import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { buildTagTree, sortTree, type TagTreeNode } from "../../lib/tagTree";
import { useUiStore } from "../../store/uiStore";
import { useVaultStore } from "../../store/vaultStore";
import { TagRenameDialog } from "./TagRenameDialog";
import "./TagsPanel.css";

function matchesFilter(node: TagTreeNode, filter: string): boolean {
  if (node.fullPath.toLowerCase().includes(filter)) return true;
  return node.children.some((child) => matchesFilter(child, filter));
}

function TagRow({
  node,
  depth,
  filter,
  onRename,
}: {
  node: TagTreeNode;
  depth: number;
  filter: string;
  onRename: (tag: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const openSearchWithQuery = useUiStore((s) => s.openSearchWithQuery);
  const hasChildren = node.children.length > 0;
  const visibleChildren = filter
    ? node.children.filter((c) => matchesFilter(c, filter))
    : node.children;

  if (filter && !matchesFilter(node, filter)) return null;

  return (
    <li>
      <div className="tag-row" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className={`tag-caret${expanded ? "" : " collapsed"}`}
            onClick={() => setExpanded((e) => !e)}
          >
            ▾
          </button>
        ) : (
          <span className="tag-caret-spacer" />
        )}
        <button
          type="button"
          className="tag-name-btn"
          onClick={() => openSearchWithQuery(`tag:${node.fullPath}`)}
        >
          #{node.name}
        </button>
        {node.count != null && <span className="tag-count">{node.count}</span>}
        <button
          type="button"
          className="tag-rename-btn"
          title="Rename"
          onClick={() => onRename(node.fullPath)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 2.5 13.5 5 5 13.5H2.5V11z" />
          </svg>
        </button>
      </div>
      {hasChildren && expanded && (
        <ul className="tag-children">
          {visibleChildren.map((child) => (
            <TagRow key={child.fullPath} node={child} depth={depth + 1} filter={filter} onRename={onRename} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TagsPanel() {
  const { t } = useTranslation();
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const [counts, setCounts] = useState<{ tag: string; count: number }[]>([]);
  const [sortMode, setSortMode] = useState<"alpha" | "frequency">("alpha");
  const [filter, setFilter] = useState("");
  const [renamingTag, setRenamingTag] = useState<string | null>(null);

  useEffect(() => {
    api.getTagCounts().then(setCounts);
  }, [changeVersion]);

  const tree = useMemo(() => sortTree(buildTagTree(counts), sortMode), [counts, sortMode]);
  const filterLower = filter.trim().toLowerCase();

  return (
    <div className="tags-panel">
      <div className="tags-panel-toolbar">
        <input
          className="tags-filter-input"
          placeholder={t("tags.filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="tags-sort-toggle">
          <button
            type="button"
            className={sortMode === "alpha" ? "active" : ""}
            title={t("tags.sortAlpha")}
            onClick={() => setSortMode("alpha")}
          >
            A→Z
          </button>
          <button
            type="button"
            className={sortMode === "frequency" ? "active" : ""}
            title={t("tags.sortFrequency")}
            onClick={() => setSortMode("frequency")}
          >
            #
          </button>
        </div>
      </div>
      {tree.length === 0 ? (
        <p className="side-panel-empty">{t("tags.empty")}</p>
      ) : (
        <ul className="tags-tree">
          {tree.map((node) => (
            <TagRow key={node.fullPath} node={node} depth={0} filter={filterLower} onRename={setRenamingTag} />
          ))}
        </ul>
      )}
      {renamingTag && (
        <TagRenameDialog tag={renamingTag} onClose={() => setRenamingTag(null)} />
      )}
    </div>
  );
}

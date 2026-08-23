import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { displayName } from "../../lib/displayName";
import type { PluginContext } from "../../plugins/context";
import type { PropertyRow } from "../../types/vault";
import "./AllPropertiesPanel.css";

function groupByKey(rows: PropertyRow[]): Map<string, PropertyRow[]> {
  const map = new Map<string, PropertyRow[]>();
  for (const row of rows) {
    const list = map.get(row.key) ?? [];
    list.push(row);
    map.set(row.key, list);
  }
  return map;
}

function PropertyGroup({
  propKey,
  rows,
  ctx,
}: {
  propKey: string;
  rows: PropertyRow[];
  ctx: PluginContext;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li>
      <button type="button" className="all-props-key-row" onClick={() => setExpanded((e) => !e)}>
        <ChevronDown size={12} className={`all-props-caret${expanded ? "" : " collapsed"}`} />
        <span className="all-props-key">{propKey}</span>
        <span className="all-props-count">{rows.length}</span>
      </button>
      {expanded && (
        <ul className="all-props-occurrences">
          {rows.map((row) => (
            <li key={row.path}>
              <button type="button" className="outline-item" onClick={() => void ctx.workspace.openNote(row.path)}>
                {displayName(row.path)}
                {row.value && <span className="all-props-value">{row.value}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Straight from the index's `properties` table via one Tauri call — this
 * used to re-read and re-parse every note in the vault client-side, which
 * wouldn't hold up on a large vault; the index already has this precomputed
 * and kept current incrementally as notes are (re)indexed. */
export function AllPropertiesPanel({ ctx }: { ctx: PluginContext }) {
  const { t } = useTranslation();
  const rows = ctx.vault.useAllProperties();
  const grouped = useMemo(() => groupByKey(rows), [rows]);
  const keys = useMemo(() => [...grouped.keys()].sort((a, b) => a.localeCompare(b)), [grouped]);

  if (keys.length === 0) {
    return <p className="side-panel-empty">{t("plugins.noteProperties.allEmpty")}</p>;
  }

  return (
    <ul className="all-props-list">
      {keys.map((key) => (
        <PropertyGroup key={key} propKey={key} rows={grouped.get(key) ?? []} ctx={ctx} />
      ))}
    </ul>
  );
}

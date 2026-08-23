import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { displayName } from "../../lib/displayName";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { Backlink, Mention } from "../../types/vault";

function groupByFile(backlinks: Backlink[]): [string, Backlink[]][] {
  const groups = new Map<string, Backlink[]>();
  for (const b of backlinks) {
    const list = groups.get(b.fromPath) ?? [];
    list.push(b);
    groups.set(b.fromPath, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.line - b.line);
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function BacklinksPanel({
  path,
  query = "",
  reversed = false,
}: {
  path: string;
  query?: string;
  reversed?: boolean;
}) {
  const { t } = useTranslation();
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const jumpToLine = useWorkspaceStore((s) => s.jumpToLine);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getBacklinks(path), api.getUnlinkedMentions(path)]).then(
      ([bl, m]) => {
        if (!cancelled) {
          setBacklinks(bl);
          setMentions(m);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, changeVersion]);

  const grouped = useMemo(() => groupByFile(backlinks), [backlinks]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = useMemo(() => {
    const filtered = grouped
      .map(([fromPath, items]) => [
        fromPath,
        normalizedQuery
          ? items.filter((item) =>
              `${fromPath} ${item.context}`.toLocaleLowerCase().includes(normalizedQuery),
            )
          : items,
      ] as [string, Backlink[]])
      .filter(([, items]) => items.length > 0);
    return reversed ? filtered.reverse() : filtered;
  }, [grouped, normalizedQuery, reversed]);
  const visibleMentions = useMemo(() => {
    const filtered = normalizedQuery
      ? mentions.filter((mention) =>
          `${mention.fromPath} ${mention.context}`.toLocaleLowerCase().includes(normalizedQuery),
        )
      : [...mentions];
    return reversed ? filtered.reverse() : filtered;
  }, [mentions, normalizedQuery, reversed]);

  async function link(mention: Mention) {
    await api.linkMention(mention.fromPath, mention.start, mention.end, displayName(path));
    useVaultStore.getState().bumpChangeVersion();
  }

  return (
    <div className="backlinks-panel">
      <section>
        <h3 className="side-panel-heading">
          <span>{t("backlinks.title")}</span>
          <span className="side-panel-count">{visibleGroups.reduce((sum, [, items]) => sum + items.length, 0)}</span>
        </h3>
        {visibleGroups.length === 0 ? (
          <p className="side-panel-empty">{t("backlinks.empty")}</p>
        ) : (
          <ul className="backlinks-group-list">
            {visibleGroups.map(([fromPath, items]) => (
              <li key={fromPath} className="backlink-group">
                <div className="backlink-source">{displayName(fromPath)}</div>
                <ul className="backlinks-list">
                  {items.map((b, i) => (
                    <li key={`${fromPath}-${b.line}-${i}`}>
                      <button
                        type="button"
                        className="backlink-item"
                        onClick={() => void jumpToLine(fromPath, b.line)}
                      >
                        <span className="backlink-context">{b.context}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="side-panel-heading">
          <span>{t("backlinks.unlinkedTitle")}</span>
          <span className="side-panel-count">{visibleMentions.length}</span>
        </h3>
        {visibleMentions.length === 0 ? (
          <p className="side-panel-empty">{t("backlinks.unlinkedEmpty")}</p>
        ) : (
          <ul className="backlinks-list">
            {visibleMentions.map((m, i) => (
              <li key={`${m.fromPath}-${i}`} className="backlink-item">
                <div className="backlink-source">{displayName(m.fromPath)}</div>
                <div className="backlink-context">{m.context}</div>
                <button type="button" onClick={() => link(m)}>
                  {t("backlinks.linkButton")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

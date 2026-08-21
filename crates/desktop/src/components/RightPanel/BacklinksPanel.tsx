import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { displayName } from "../../lib/displayName";
import { useVaultStore } from "../../store/vaultStore";
import type { Backlink, Mention } from "../../types/vault";

export function BacklinksPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const changeVersion = useVaultStore((s) => s.changeVersion);
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

  async function link(mention: Mention) {
    await api.linkMention(mention.fromPath, mention.start, mention.end, displayName(path));
    useVaultStore.getState().bumpChangeVersion();
  }

  return (
    <div className="backlinks-panel">
      <section>
        <h3 className="side-panel-heading">
          {t("backlinks.title")} ({backlinks.length})
        </h3>
        {backlinks.length === 0 ? (
          <p className="side-panel-empty">{t("backlinks.empty")}</p>
        ) : (
          <ul className="backlinks-list">
            {backlinks.map((b, i) => (
              <li key={`${b.fromPath}-${i}`} className="backlink-item">
                <div className="backlink-source">{b.fromPath}</div>
                <div className="backlink-context">{b.context}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="side-panel-heading">
          {t("backlinks.unlinkedTitle")} ({mentions.length})
        </h3>
        {mentions.length === 0 ? (
          <p className="side-panel-empty">{t("backlinks.unlinkedEmpty")}</p>
        ) : (
          <ul className="backlinks-list">
            {mentions.map((m, i) => (
              <li key={`${m.fromPath}-${i}`} className="backlink-item">
                <div className="backlink-source">{m.fromPath}</div>
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

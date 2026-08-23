import { useTranslation } from "react-i18next";
import type { PluginContext } from "../../plugins/context";

export function OutgoingLinksPanel({ ctx, path }: { ctx: PluginContext; path: string }) {
  const { t } = useTranslation();
  const links = ctx.vault.useOutgoingLinks(path);

  if (links.length === 0) {
    return <p className="side-panel-empty">{t("plugins.outgoingLinks.empty")}</p>;
  }

  return (
    <ul className="outline-list">
      {links.map((link, i) => (
        <li key={`${link.kind}:${link.targetText}:${i}`}>
          <button
            type="button"
            className={`outline-item${link.toPath ? "" : " outgoing-link-unresolved"}`}
            disabled={!link.toPath}
            onClick={() => link.toPath && void ctx.workspace.openNote(link.toPath)}
          >
            {link.targetText}
          </button>
        </li>
      ))}
    </ul>
  );
}

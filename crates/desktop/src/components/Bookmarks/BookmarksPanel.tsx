import { Bookmark, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { displayName } from "../../lib/displayName";
import type { PluginContext } from "../../plugins/context";
import "./BookmarksPanel.css";

export function BookmarksPanel({ ctx }: { ctx: PluginContext }) {
  const { t } = useTranslation();
  const bookmarks = ctx.vault.useBookmarks();

  if (bookmarks.length === 0) {
    return <p className="side-panel-empty">{t("plugins.bookmarks.empty")}</p>;
  }

  return (
    <ul className="outline-list">
      {bookmarks.map((path) => (
        <li key={path} className="bookmark-row">
          <button
            type="button"
            className="outline-item bookmark-open-btn"
            onClick={() => void ctx.workspace.openNote(path)}
          >
            <Bookmark size={13} className="bookmark-row-icon" />
            {displayName(path)}
          </button>
          <button
            type="button"
            className="bookmark-remove-btn"
            title={t("plugins.bookmarks.remove")}
            onClick={() => void ctx.vault.toggleBookmark(path)}
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

import { useState } from "react";
import { Bookmark, BookmarkPlus, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { displayName } from "../../lib/displayName";
import type { PluginContext } from "../../plugins/context";
import { Tooltip } from "../ui/Tooltip";
import "./BookmarksPanel.css";

export function BookmarksPanel({ ctx }: { ctx: PluginContext }) {
  const { t } = useTranslation();
  const bookmarks = ctx.vault.useBookmarks();
  const activePath = ctx.workspace.useActiveNotePath();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const canAddActive = activePath != null && !bookmarks.includes(activePath);
  const trimmed = query.trim().toLowerCase();
  const visible = trimmed
    ? bookmarks.filter((path) => displayName(path).toLowerCase().includes(trimmed))
    : bookmarks;

  return (
    <div className="bookmarks-panel">
      <div className="bookmarks-actions">
        <Tooltip label={t("plugins.bookmarks.addActive")} placement="bottom">
          <button
            type="button"
            disabled={!canAddActive}
            onClick={() => activePath && void ctx.vault.toggleBookmark(activePath)}
          >
            <BookmarkPlus size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Tooltip label={t("plugins.bookmarks.search")} placement="bottom">
          <button
            type="button"
            className={searchOpen ? "active" : ""}
            aria-pressed={searchOpen}
            onClick={() => {
              setSearchOpen((v) => !v);
              setQuery("");
            }}
          >
            <Search size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>

      {searchOpen && (
        <input
          className="field bookmarks-search"
          autoFocus
          placeholder={t("plugins.bookmarks.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      )}

      {bookmarks.length === 0 ? (
        <p className="bookmarks-empty">{t("plugins.bookmarks.empty")}</p>
      ) : (
        <ul className="outline-list">
          {visible.map((path) => (
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
      )}
    </div>
  );
}

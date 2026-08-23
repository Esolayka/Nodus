import { Bookmark } from "lucide-react";
import i18next from "../i18n";
import { BookmarksPanel } from "../components/Bookmarks/BookmarksPanel";
import type { NodusPlugin } from "./types";

export const bookmarksPlugin: NodusPlugin = {
  id: "core.bookmarks",
  nameKey: "plugins.bookmarks.name",
  descriptionKey: "plugins.bookmarks.description",
  tier: "isolated",
  defaultEnabled: true,
  onEnable(ctx) {
    const unregisterView = ctx.registerSidebarView({
      id: "core.bookmarks",
      order: 50,
      titleKey: "plugins.bookmarks.title",
      icon: Bookmark,
      component: () => <BookmarksPanel ctx={ctx} />,
    });
    const unregisterCommand = ctx.registerCommand({
      id: "bookmarks.toggleActive",
      title: i18next.t("plugins.bookmarks.toggleCommand"),
      run: () => {
        const path = ctx.workspace.getActiveNotePath();
        if (path) void ctx.vault.toggleBookmark(path);
      },
    });
    return () => {
      unregisterView();
      unregisterCommand();
    };
  },
};

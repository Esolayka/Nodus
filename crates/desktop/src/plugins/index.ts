import { bookmarksPlugin } from "./bookmarks";
import { footnotesPlugin } from "./footnotes";
import { notePropertiesPlugin } from "./noteProperties";
import { outgoingLinksPlugin } from "./outgoingLinks";
import { randomNotePlugin } from "./randomNote";
import { uniqueNoteNamesPlugin } from "./uniqueNoteNames";
import type { NodusPlugin } from "./types";

export const ALL_PLUGINS: NodusPlugin[] = [
  notePropertiesPlugin,
  outgoingLinksPlugin,
  bookmarksPlugin,
  footnotesPlugin,
  randomNotePlugin,
  uniqueNoteNamesPlugin,
];

export type { NodusPlugin };

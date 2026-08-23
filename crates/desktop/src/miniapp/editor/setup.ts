// Composes the same CodeMirror 6 building blocks the desktop editor uses
// (live preview, syntax highlighting, list/formatting commands) with a
// Mini-App-specific wikilink layer, since the desktop's own wikilink
// plugin reads from a Tauri-backed store this app doesn't have.

import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { codeHighlightStyle } from "../../editor/codeHighlightStyle";
import { editorTheme } from "../../editor/editorTheme";
import { toggleBold, toggleItalic } from "../../editor/formatting";
import { listEnter, listIndent, listOutdent } from "../../editor/listCommands";
import { livePreview } from "../../editor/livePreview";
import { editorModeField } from "../../editor/modeState";
import type { NoteIndex } from "../../lib/noteIndex";
import { wikilinkCompletionSource } from "./wikilinkAutocomplete";
import { type FollowLink, wikilinks } from "./wikilinks";

export function miniAppEditorExtensions(path: string, noteIndex: NoteIndex, onFollowLink: FollowLink): Extension[] {
  return [
    editorModeField,
    history(),
    markdown({ codeLanguages: languages, extensions: [GFM] }),
    syntaxHighlighting(codeHighlightStyle),
    livePreview,
    wikilinks(path, noteIndex, onFollowLink),
    autocompletion({ override: [wikilinkCompletionSource(noteIndex)] }),
    editorTheme,
    EditorView.lineWrapping,
    keymap.of([
      { key: "Tab", run: acceptCompletion },
      { key: "Enter", run: listEnter },
      { key: "Tab", run: listIndent },
      { key: "Shift-Tab", run: listOutdent },
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
  ];
}

import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { Annotation, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { codeHighlightStyle } from "./codeHighlightStyle";
import { editorTheme } from "./editorTheme";
import { embeds } from "./embeds";
import { footnotes } from "./footnotes";
import { toggleBold, toggleItalic, insertLink, pasteAsLink } from "./formatting";
import { frontmatterPanel } from "./frontmatter";
import { inFileSearch, openInFileSearch } from "./inFileSearch";
import { latex } from "./latex";
import { linkClickHandler } from "./links";
import { linkHoverPreview } from "./linkHoverPreview";
import { listEnter, listIndent, listOutdent } from "./listCommands";
import { livePreview } from "./livePreview";
import { editorModeField } from "./modeState";
import { tagCompletionSources } from "./tagAutocomplete";
import { tags } from "./tags";
import { matchedTextTheme, wikilinkCompletionSources } from "./wikilinkAutocomplete";
import { type FollowLink, wikilinks } from "./wikilinks";
import { selectionToolbar } from "./selectionToolbar";

/** Tags a transaction as programmatic (external reload / initial load) so the
 * change listener can skip it instead of treating it as a user edit. */
export const externalUpdate = Annotation.define<boolean>();

export function buildExtensions(
  path: string,
  onChange: (content: string) => void,
  onSave: () => void,
  onFollowLink: FollowLink,
): Extension[] {
  return [
    editorModeField,
    EditorView.editable.compute([editorModeField], (state) => state.field(editorModeField) !== "reading"),
    history(),
    keymap.of([
      { key: "Mod-s", run: () => (onSave(), true), preventDefault: true },
      { key: "Mod-b", run: toggleBold, preventDefault: true },
      { key: "Mod-i", run: toggleItalic, preventDefault: true },
      { key: "Mod-k", run: insertLink, preventDefault: true },
      { key: "Enter", run: listEnter },
      { key: "Tab", run: acceptCompletion },
      { key: "Tab", run: listIndent },
      { key: "Shift-Tab", run: listOutdent },
      indentWithTab,
      {
        key: "Mod-f",
        run: (view) => {
          openInFileSearch(view);
          return true;
        },
        preventDefault: true,
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    markdown({ extensions: GFM, codeLanguages: languages }),
    syntaxHighlighting(codeHighlightStyle),
    inFileSearch(),
    EditorView.lineWrapping,
    livePreview,
    wikilinks(path, onFollowLink),
    embeds(path, onFollowLink),
    // A single `autocompletion()` call — CodeMirror's `override` config can
    // only be set once per editor, so the wikilink and tag completion
    // sources have to be combined here rather than each wrapping their own.
    autocompletion({ override: [...wikilinkCompletionSources(path), ...tagCompletionSources()] }),
    matchedTextTheme,
    tags(),
    latex,
    footnotes,
    frontmatterPanel,
    linkClickHandler(),
    linkHoverPreview(),
    pasteAsLink(),
    selectionToolbar,
    editorTheme,
    EditorView.domEventHandlers({
      blur: () => {
        onSave();
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(externalUpdate))) return;
      onChange(update.state.doc.toString());
    }),
  ];
}

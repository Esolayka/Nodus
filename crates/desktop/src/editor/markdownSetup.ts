import { acceptCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { codeHighlightStyle } from "./codeHighlightStyle";
import { editorTheme } from "./editorTheme";
import { embeds } from "./embeds";
import { footnotes } from "./footnotes";
import { toggleBold, toggleItalic, insertLink, pasteAsLink } from "./formatting";
import { frontmatterPanel } from "./frontmatter";
import { latex } from "./latex";
import { linkClickHandler } from "./links";
import { linkHoverPreview } from "./linkHoverPreview";
import { listEnter, listIndent, listOutdent } from "./listCommands";
import { livePreview } from "./livePreview";
import { editorModeField } from "./modeState";
import { wikilinkAutocomplete } from "./wikilinkAutocomplete";
import { type FollowLink, wikilinks } from "./wikilinks";

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
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    markdown({ extensions: GFM, codeLanguages: languages }),
    syntaxHighlighting(codeHighlightStyle),
    search({ top: true }),
    EditorView.lineWrapping,
    livePreview,
    wikilinks(path, onFollowLink),
    embeds(path, onFollowLink),
    wikilinkAutocomplete(path),
    latex,
    footnotes,
    frontmatterPanel,
    linkClickHandler(),
    linkHoverPreview(),
    pasteAsLink(),
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

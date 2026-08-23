import { snippet } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Matches a `{{cursor}}` marker with the same tolerance for inner
 * whitespace as the template engine's own variable regex, so `{{ cursor }}`
 * still counts. */
const CURSOR_RE = /\{\{\s*cursor\s*\}\}/g;

/** CodeMirror's snippet syntax treats `{`/`}` as placeholder delimiters —
 * escape any that survive in the literal (non-cursor) parts of the
 * expanded template so they render as plain text instead of being
 * misparsed, exactly as the library's own docs prescribe. */
function escapeForSnippet(text: string): string {
  return text.replace(/[{}]/g, (ch) => `\\${ch}`);
}

/** Inserts already-variable-expanded template text at the current
 * selection as a single undo step. Each `{{cursor}}` marker becomes a
 * snippet tab-stop (Tab/Shift-Tab cycles between them, matching
 * CodeMirror's own snippet keymap); with none present, the cursor is placed
 * right after the inserted text. */
export function insertExpandedTemplate(view: EditorView, expandedText: string): void {
  const { from, to } = view.state.selection.main;

  if (!CURSOR_RE.test(expandedText)) {
    view.dispatch({
      changes: { from, to, insert: expandedText },
      selection: EditorSelection.cursor(from + expandedText.length),
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  CURSOR_RE.lastIndex = 0;
  const parts = expandedText.split(CURSOR_RE);
  const templateText = parts.map(escapeForSnippet).join("${}");
  snippet(templateText)(view, null, from, to);
  view.focus();
}

import { EditorSelection } from "@codemirror/state";
import { EditorView, type Command } from "@codemirror/view";

/** Wraps the selection in `marker` on both sides, or un-wraps it if it's
 * already wrapped — so pressing the shortcut twice toggles back off. Works
 * with an empty selection too: markers land around the cursor, ready to type. */
function toggleWrap(marker: string): Command {
  return (view) => {
    const changes = view.state.changeByRange((range) => {
      const before = view.state.sliceDoc(Math.max(0, range.from - marker.length), range.from);
      const after = view.state.sliceDoc(range.to, range.to + marker.length);
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - marker.length, to: range.from },
            { from: range.to, to: range.to + marker.length },
          ],
          range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
      };
    });
    view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");
export const toggleStrikethrough = toggleWrap("~~");
export const toggleInlineCode = toggleWrap("`");

/** Wraps a selection as an Obsidian-style internal link. With an empty
 * selection the cursor lands between the brackets, ready for a note name. */
export const insertWikiLink: Command = (view) => {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const insert = `[[${text}]]`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text
        ? EditorSelection.range(range.from + 2, range.from + 2 + text.length)
        : EditorSelection.cursor(range.from + 2),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export const insertLink: Command = (view) => {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const insert = `[${text}](url)`;
    const urlStart = range.from + 1 + text.length + 2;
    return {
      changes: [{ from: range.from, to: range.to, insert }],
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

const URL_RE = /^https?:\/\/\S+$/i;

/** Pasting a bare URL over a selection wraps the selected text as the link
 * label instead of replacing it — the common "paste a link onto some words"
 * gesture. A paste with nothing selected, or that isn't a plain URL, is left
 * to the browser's default paste handling. */
export function pasteAsLink() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!text || !URL_RE.test(text)) return false;
      const { from, to } = view.state.selection.main;
      if (from === to) return false;
      const selected = view.state.sliceDoc(from, to);
      const insert = `[${selected}](${text})`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      event.preventDefault();
      return true;
    },
  });
}

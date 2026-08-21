import { indentLess, indentMore } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import type { Command } from "@codemirror/view";

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s*)?/;

function currentListItem(state: EditorState) {
  const { from, to } = state.selection.main;
  if (from !== to) return null; // keep list-editing shortcuts to a plain caret
  const line = state.doc.lineAt(from);
  const match = LIST_ITEM_RE.exec(line.text);
  return match ? { line, match } : null;
}

/** Enter inside a list item: continues the list with a matching marker (and
 * an incremented number for ordered lists), or — on an already-empty item —
 * removes the marker and drops out of the list instead of adding another
 * blank bullet. */
export const listEnter: Command = (view) => {
  const info = currentListItem(view.state);
  if (!info) return false;
  const { line, match } = info;
  const [full, indent, marker, , checkbox] = match;
  const cursor = view.state.selection.main.head;
  if (cursor < line.from + full.length) return false; // still inside the marker itself

  const restOfLine = line.text.slice(full.length);
  if (restOfLine.trim() === "" && cursor === line.to) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
    });
    return true;
  }

  let nextMarker = marker;
  if (/^\d+[.)]$/.test(marker)) {
    nextMarker = `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}`;
  }
  const insert = `\n${indent}${nextMarker} ${checkbox ? "[ ] " : ""}`;
  view.dispatch({
    changes: { from: cursor, insert },
    selection: { anchor: cursor + insert.length },
  });
  return true;
};

export const listIndent: Command = (view) => (currentListItem(view.state) ? indentMore(view) : false);

export const listOutdent: Command = (view) =>
  currentListItem(view.state) ? indentLess(view) : false;

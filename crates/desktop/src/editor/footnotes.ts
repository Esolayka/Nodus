import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { editorModeField, modeChanged } from "./modeState";

// `[^label]` reference, not immediately followed by `:` at line start (that
// pattern is the *definition*, handled separately below).
const REFERENCE_RE = /\[\^([^\]\s]+)\]/g;
const DEFINITION_RE = /^\[\^([^\]\s]+)\]:/;

function cursorLineRange(state: EditorState): { from: number; to: number } {
  const line = state.doc.lineAt(state.selection.main.head);
  return { from: line.from, to: line.to };
}

function buildDecorations(view: EditorView): DecorationSet {
  const mode = view.state.field(editorModeField, false) ?? "live";
  if (mode === "source") return Decoration.none;
  const active = mode === "reading" ? { from: -1, to: -2 } : cursorLineRange(view.state);

  const decorations: Range<Decoration>[] = [];
  const doc = view.state.doc;

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const defMatch = DEFINITION_RE.exec(line.text);
    if (defMatch) {
      decorations.push(Decoration.line({ class: "cm-footnote-def-line" }).range(line.from));
    }
  }

  const text = doc.toString();
  for (const m of text.matchAll(REFERENCE_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    const lineStart = doc.lineAt(from);
    // Skip the definition's own `[^label]:` — it's styled as a whole line above.
    if (DEFINITION_RE.test(lineStart.text) && from === lineStart.from) continue;
    const isActive = from <= active.to && to >= active.from;
    if (isActive) {
      decorations.push(Decoration.mark({ class: "cm-footnote-ref-raw" }).range(from, to));
    } else {
      decorations.push(Decoration.mark({ class: "cm-footnote-ref" }).range(from, to));
    }
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

class FootnotePlugin implements PluginValue {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || modeChanged(update.transactions)) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const footnotes = ViewPlugin.fromClass(FootnotePlugin, {
  decorations: (plugin) => plugin.decorations,
});

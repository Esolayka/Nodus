import katex from "katex";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorModeField } from "./modeState";

const BLOCK_RE = /\$\$([\s\S]+?)\$\$/g;
const INLINE_RE = /\$([^\n$]+?)\$/g;

interface MathSpan {
  from: number;
  to: number;
  formula: string;
  block: boolean;
}

function findMathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  for (const m of text.matchAll(BLOCK_RE)) {
    spans.push({ from: m.index, to: m.index + m[0].length, formula: m[1], block: true });
  }
  for (const m of text.matchAll(INLINE_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (!m[1].trim()) continue;
    if (spans.some((s) => from < s.to && to > s.from)) continue;
    spans.push({ from, to, formula: m[1], block: false });
  }
  spans.sort((a, b) => a.from - b.from);
  return spans;
}

class MathWidget extends WidgetType {
  constructor(
    readonly formula: string,
    readonly block: boolean,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.formula === this.formula && other.block === this.block;
  }

  toDOM(): HTMLElement {
    const container = document.createElement(this.block ? "div" : "span");
    container.className = this.block ? "cm-math-block" : "cm-math-inline";
    try {
      container.innerHTML = katex.renderToString(this.formula, {
        throwOnError: false,
        displayMode: this.block,
      });
    } catch {
      container.textContent = this.block ? `$$${this.formula}$$` : `$${this.formula}$`;
    }
    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function cursorLineRange(state: EditorState): { from: number; to: number } {
  const line = state.doc.lineAt(state.selection.main.head);
  return { from: line.from, to: line.to };
}

function buildDecorations(state: EditorState): DecorationSet {
  const mode = state.field(editorModeField, false) ?? "live";
  if (mode === "source") return Decoration.none;
  const active = mode === "reading" ? { from: -1, to: -2 } : cursorLineRange(state);

  const text = state.doc.toString();
  const decorations: Range<Decoration>[] = [];
  for (const span of findMathSpans(text)) {
    const isActive = span.from <= active.to && span.to >= active.from;
    if (isActive) continue;
    // Not using CodeMirror's `block: true` replace option — that requires
    // the range to sit exactly on line boundaries, which `$$...$$` doesn't
    // reliably do, and multi-line replacements need a StateField either way
    // (not allowed from a ViewPlugin). The widget's own `div` already
    // renders block-level.
    decorations.push(
      Decoration.replace({ widget: new MathWidget(span.formula, span.block) }).range(
        span.from,
        span.to,
      ),
    );
  }
  return Decoration.set(decorations, true);
}

export const latex = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (_decorations, tr) => buildDecorations(tr.state),
  provide: (field) => EditorView.decorations.from(field),
});

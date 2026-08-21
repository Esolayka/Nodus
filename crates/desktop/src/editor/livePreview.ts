import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import mermaid from "mermaid";
import { editorModeField } from "./modeState";
import { parseMarkdownTable } from "./markdownTable";

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-mermaid";
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, this.code)
      .then(({ svg }) => {
        container.innerHTML = svg;
      })
      .catch((err: unknown) => {
        container.textContent = String(err);
        container.classList.add("cm-mermaid-error");
      });
    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * "Live preview": markdown markup (heading `#`, `**bold**`, `` `code` ``, …)
 * is hidden and replaced with real styling everywhere *except* on the line
 * the cursor is currently on (or, for block constructs like tables, anywhere
 * within it), where the raw source is shown so it stays editable.
 *
 * A `StateField`, not a `ViewPlugin` — CodeMirror only allows block-level
 * decorations and decorations that replace a line break (both needed here,
 * for tables/Mermaid/rules) to come from a `StateField`. The cost is losing
 * `view.visibleRanges` as a viewport optimization — decorations are computed
 * for the whole document on every relevant change — which is fine at the
 * size of a single note.
 *
 * Three modes share this one field rather than three separate code paths:
 * "source" bails out to an empty decoration set (raw text, full stop);
 * "reading" fakes an active-line range that can never overlap anything, so
 * every construct renders fully hidden/replaced with nothing left editable
 * in spirit (the view is also marked non-editable elsewhere); "live" is the
 * normal cursor-aware behavior.
 */

const HIDDEN_MARK_NAMES = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "QuoteMark",
  "LinkMark",
  "URL",
]);

const HEADING_LEVEL: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
    readonly disabled: boolean,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.disabled === other.disabled;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.disabled = this.disabled;
    input.className = "cm-task-checkbox";
    input.addEventListener("mousedown", (e) => e.preventDefault());
    input.addEventListener("change", () => {
      const replacement = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: replacement },
      });
    });
    return input;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-list-bullet";
    span.textContent = "•";
    return span;
  }
}

class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-hr";
    return div;
  }
}

class TableWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const { header, aligns, rows } = parseMarkdownTable(this.text);
    const table = document.createElement("table");
    table.className = "cm-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    header.forEach((cell, i) => {
      const th = document.createElement("th");
      th.textContent = cell;
      if (aligns[i]) th.style.textAlign = aligns[i] as string;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = document.createElement("td");
        td.textContent = cell;
        if (aligns[i]) td.style.textAlign = aligns[i] as string;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }
}

function cursorLineRange(state: EditorState): { from: number; to: number } {
  const line = state.doc.lineAt(state.selection.main.head);
  return { from: line.from, to: line.to };
}

function overlapsActive(
  node: { from: number; to: number },
  active: { from: number; to: number },
): boolean {
  return node.from <= active.to && node.to >= active.from;
}

function buildDecorations(state: EditorState): DecorationSet {
  const mode = state.field(editorModeField, false) ?? "live";
  if (mode === "source") return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  // "reading" mode: an active range that can never overlap real content, so
  // every hide/replace branch below always fires.
  const active = mode === "reading" ? { from: -1, to: -2 } : cursorLineRange(state);
  const readingMode = mode === "reading";

  syntaxTree(state).iterate({
    enter: (node: SyntaxNode) => {
      const isActive = overlapsActive(node, active);

      const headingLevel = HEADING_LEVEL[node.name];
      if (headingLevel) {
        decorations.push(
          Decoration.line({ class: `cm-heading cm-heading-${headingLevel}` }).range(
            state.doc.lineAt(node.from).from,
          ),
        );
      } else if (node.name === "StrongEmphasis") {
        decorations.push(Decoration.mark({ class: "cm-strong" }).range(node.from, node.to));
      } else if (node.name === "Emphasis") {
        decorations.push(Decoration.mark({ class: "cm-emphasis" }).range(node.from, node.to));
      } else if (node.name === "Strikethrough") {
        decorations.push(Decoration.mark({ class: "cm-strikethrough" }).range(node.from, node.to));
      } else if (node.name === "InlineCode") {
        decorations.push(Decoration.mark({ class: "cm-inline-code" }).range(node.from, node.to));
      } else if (node.name === "FencedCode" || node.name === "CodeBlock") {
        if (node.name === "FencedCode" && !isActive) {
          const fullText = state.sliceDoc(node.from, node.to);
          const firstBreak = fullText.indexOf("\n");
          const infoLine = firstBreak === -1 ? fullText : fullText.slice(0, firstBreak);
          const lang = infoLine.replace(/^[`~]{3,}/, "").trim().toLowerCase();
          if (lang === "mermaid") {
            const lines = fullText.split("\n");
            const closingFence = /^[`~]{3,}\s*$/.test(lines[lines.length - 1] ?? "");
            const body = lines.slice(1, closingFence ? -1 : undefined).join("\n");
            decorations.push(
              Decoration.replace({ widget: new MermaidWidget(body) }).range(node.from, node.to),
            );
            return false;
          }
        }
        let lineNode = state.doc.lineAt(node.from);
        const end = node.to;
        while (lineNode.from <= end) {
          decorations.push(Decoration.line({ class: "cm-code-line" }).range(lineNode.from));
          if (lineNode.to >= state.doc.length) break;
          lineNode = state.doc.lineAt(lineNode.to + 1);
        }
      } else if (node.name === "Blockquote") {
        let lineNode = state.doc.lineAt(node.from);
        const end = node.to;
        while (lineNode.from <= end) {
          decorations.push(Decoration.line({ class: "cm-blockquote-line" }).range(lineNode.from));
          if (lineNode.to >= state.doc.length) break;
          lineNode = state.doc.lineAt(lineNode.to + 1);
        }
      } else if (node.name === "Link") {
        decorations.push(Decoration.mark({ class: "cm-link" }).range(node.from, node.to));
      } else if (node.name === "URL" && node.node.parent?.name !== "Link") {
        // A bare autolinked URL (GFM), not the URL part of `[text](url)`.
        decorations.push(
          Decoration.mark({ class: "cm-link cm-bare-url" }).range(node.from, node.to),
        );
        return;
      } else if (node.name === "TaskMarker") {
        const text = state.sliceDoc(node.from, node.to);
        decorations.push(
          Decoration.replace({
            widget: new CheckboxWidget(text.toLowerCase() === "[x]", node.from, node.to, readingMode),
          }).range(node.from, node.to),
        );
        return;
      } else if (node.name === "ListMark") {
        const listKind = node.node.parent?.parent?.name;
        if (listKind === "BulletList" && !isActive) {
          decorations.push(
            Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
          );
          return;
        }
        if (listKind === "OrderedList") {
          decorations.push(Decoration.mark({ class: "cm-list-number" }).range(node.from, node.to));
        }
      } else if (node.name === "HorizontalRule") {
        if (!isActive) {
          decorations.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
        } else {
          decorations.push(Decoration.mark({ class: "cm-hr-raw" }).range(node.from, node.to));
        }
        return;
      } else if (node.name === "Table") {
        if (!isActive) {
          const from = state.doc.lineAt(node.from).from;
          const to = state.doc.lineAt(node.to).to;
          decorations.push(
            Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to)) }).range(
              from,
              to,
            ),
          );
          return false;
        }
      }

      if (HIDDEN_MARK_NAMES.has(node.name) && !isActive) {
        // HeaderMark/QuoteMark cover only the `#`/`>` itself; also eat the
        // single space after it so hidden headings/quotes don't show an
        // orphaned leading space.
        let hideTo = node.to;
        if (
          (node.name === "HeaderMark" || node.name === "QuoteMark") &&
          state.sliceDoc(hideTo, hideTo + 1) === " "
        ) {
          hideTo += 1;
        }
        decorations.push(Decoration.replace({}).range(node.from, hideTo));
      }
    },
  });

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

export const livePreview = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (_decorations, tr) => buildDecorations(tr.state),
  provide: (field) => EditorView.decorations.from(field),
});

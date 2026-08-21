import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorModeField } from "./modeState";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

interface Field {
  key: string;
  value: string;
}

/** Line-based, not a real YAML parser — good enough to *display* the common
 * `key: value` / `key:\n  - item` shapes. The underlying text is never
 * regenerated from this, so there's no risk of it mangling anything a real
 * YAML parser would have understood but this one doesn't. */
function parseFields(yaml: string): Field[] {
  const fields: Field[] = [];
  const lines = yaml.split("\n");
  for (const line of lines) {
    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && fields.length > 0) {
      const last = fields[fields.length - 1];
      last.value = last.value ? `${last.value}, ${listItem[1]}` : listItem[1];
      continue;
    }
    const kv = /^(\S[^:]*):\s*(.*)$/.exec(line);
    if (kv) {
      fields.push({ key: kv[1], value: kv[2] });
    }
  }
  return fields;
}

class FrontmatterWidget extends WidgetType {
  constructor(
    readonly yaml: string,
    readonly blockFrom: number,
  ) {
    super();
  }

  eq(other: FrontmatterWidget): boolean {
    return other.yaml === this.yaml;
  }

  toDOM(view: EditorView): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "cm-frontmatter-panel";
    const fields = parseFields(this.yaml);
    if (fields.length === 0) {
      panel.classList.add("cm-frontmatter-panel-empty");
      panel.textContent = "···";
    }
    for (const field of fields) {
      const row = document.createElement("div");
      row.className = "cm-frontmatter-row";
      const key = document.createElement("span");
      key.className = "cm-frontmatter-key";
      key.textContent = field.key;
      const value = document.createElement("span");
      value.className = "cm-frontmatter-value";
      value.textContent = field.value;
      row.append(key, value);
      panel.appendChild(row);
    }
    panel.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.blockFrom + 4 } });
      view.focus();
    });
    return panel;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const mode = state.field(editorModeField, false) ?? "live";
  if (mode === "source") return Decoration.none;

  const text = state.doc.toString();
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return Decoration.none;

  const from = 0;
  const to = match[0].length;
  const cursorInside =
    mode === "live" && state.selection.main.head >= from && state.selection.main.head <= to;
  if (cursorInside) return Decoration.none;

  const decorations: Range<Decoration>[] = [
    Decoration.replace({ widget: new FrontmatterWidget(match[1], from) }).range(from, to),
  ];
  return Decoration.set(decorations);
}

export const frontmatterPanel = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (_decorations, tr) => buildDecorations(tr.state),
  provide: (field) => EditorView.decorations.from(field),
});

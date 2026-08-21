import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useUiStore } from "../store/uiStore";
import { codeRanges, inCodeRange } from "./codeRanges";

interface ParsedTag {
  start: number;
  end: number;
  tag: string;
}

function isTagChar(c: string): boolean {
  return /[\p{L}\p{N}_-]/u.test(c);
}

/** Mirrors `find_inline_tags` in `crates/core/src/tags.rs` — a tag starts at
 * a `#` not glued to a preceding word character (so `# Heading` and
 * `word#123` don't count), runs through letters/digits/`_`/`-`/`/`, and
 * needs at least one letter somewhere (so a bare `#123` isn't a tag). */
function findInlineTags(text: string, code: { from: number; to: number }[]): ParsedTag[] {
  const results: ParsedTag[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "#" && !inCodeRange(code, i)) {
      const prevChar = i > 0 ? text[i - 1] : "";
      if (!isTagChar(prevChar) && prevChar !== "#") {
        let j = i + 1;
        let name = "";
        while (j < text.length && (isTagChar(text[j]) || text[j] === "/")) {
          name += text[j];
          j++;
        }
        const trimmed = name.replace(/^\/+|\/+$/g, "");
        if (trimmed && /\p{L}/u.test(trimmed) && !trimmed.includes("//")) {
          results.push({ start: i, end: j, tag: trimmed });
          i = j;
          continue;
        }
      }
    }
    i++;
  }
  return results;
}

function buildDecorations(view: EditorView): { decorations: DecorationSet; tags: ParsedTag[] } {
  const text = view.state.doc.toString();
  const code = codeRanges(view.state);
  const parsed = findInlineTags(text, code);
  const decorations: Range<Decoration>[] = parsed.map((tag) =>
    Decoration.mark({ class: "cm-inline-tag" }).range(tag.start, tag.end),
  );
  return { decorations: Decoration.set(decorations), tags: parsed };
}

class TagsPlugin implements PluginValue {
  decorations: DecorationSet;
  tags: ParsedTag[];

  constructor(view: EditorView) {
    const built = buildDecorations(view);
    this.decorations = built.decorations;
    this.tags = built.tags;
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      const built = buildDecorations(update.view);
      this.decorations = built.decorations;
      this.tags = built.tags;
    }
  }
}

const tagsPlugin = ViewPlugin.fromClass(TagsPlugin, {
  decorations: (plugin) => plugin.decorations,
});

/** Plain click on a tag runs a `tag:` search — same as clicking it in the
 * tags panel. Unlike wikilinks, tags don't hide/reveal syntax by cursor
 * position (there's nothing to hide), so no active-line exception is needed
 * here. */
function tagClickHandler() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const plugin = view.plugin(tagsPlugin);
      const tag = plugin?.tags.find((t) => pos >= t.start && pos <= t.end);
      if (!tag) return false;
      event.preventDefault();
      useUiStore.getState().openSearchWithQuery(`tag:${tag.tag}`);
      return true;
    },
  });
}

export function tags() {
  return [tagsPlugin, tagClickHandler()];
}

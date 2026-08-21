import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Byte ranges of fenced code blocks, indented code blocks, and inline code
 * spans, per the syntax tree. Wikilink/embed rendering is a separate
 * regex-based pass over the raw text (simpler than syntax-tree-walking for
 * that shape of syntax), so it needs this to keep `[[...]]` inside code from
 * being treated as a real link — matching what the Rust indexer already
 * excludes when building the link graph. */
export function codeRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "InlineCode") {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  return ranges;
}

export function inCodeRange(ranges: { from: number; to: number }[], pos: number): boolean {
  return ranges.some((r) => pos >= r.from && pos < r.to);
}

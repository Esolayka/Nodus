import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Syntax colors for the language grammars nested inside fenced code blocks
 * (via `codeLanguages`). Deliberately reuses the app's existing design
 * tokens instead of introducing new colors — a restrained accent-plus-muted
 * palette rather than a full rainbow.
 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.moduleKeyword], color: "var(--accent)", fontWeight: "600" },
  { tag: [t.definitionKeyword, t.definition(t.variableName)], color: "var(--accent)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--accent)" },
  { tag: [t.number, t.bool, t.atom, t.self], color: "var(--accent)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--text-normal)" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--text-muted)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--text-faint)", fontStyle: "italic" },
  { tag: [t.punctuation, t.bracket, t.operator], color: "var(--text-muted)" },
  { tag: t.invalid, color: "var(--danger)" },
]);

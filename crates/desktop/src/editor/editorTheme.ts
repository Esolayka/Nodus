import { EditorView } from "@codemirror/view";

/**
 * Reads our theme CSS custom properties directly (`var(--text-normal)`,
 * etc.) instead of duplicating color values here, so light/dark switching
 * needs no changes on the editor side.
 */
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--text-normal)",
    backgroundColor: "var(--bg-primary)",
    height: "100%",
    fontSize: "var(--editor-font-size, 16px)",
  },
  ".cm-content": {
    caretColor: "var(--text-normal)",
    fontFamily: "var(--font-ui)",
    padding: "40px 0 80px",
    maxWidth: "700px",
    margin: "0 auto",
    lineHeight: "1.6",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftWidth: "2px",
    borderLeftColor: "var(--text-normal)",
  },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-heading": {
    fontWeight: "600",
    letterSpacing: "-0.02em",
  },
  ".cm-heading-1": { fontSize: "2em", fontWeight: "700", lineHeight: "1.25" },
  ".cm-heading-2": { fontSize: "1.5em", lineHeight: "1.3" },
  ".cm-heading-3": { fontSize: "1.1875em", lineHeight: "1.4" },
  ".cm-heading-4": { fontSize: "1.0625em" },
  ".cm-heading-5": { fontSize: "1em" },
  ".cm-heading-6": { fontSize: "0.875em", color: "var(--text-muted)" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-emphasis": { fontStyle: "italic" },
  ".cm-strikethrough": { textDecoration: "line-through", color: "var(--text-muted)" },
  ".cm-inline-code": {
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--bg-tertiary)",
    borderRadius: "4px",
    padding: "2px 5px",
    fontSize: "0.9em",
  },
  ".cm-code-line": {
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--bg-tertiary)",
    fontSize: "13.5px",
    lineHeight: "1.5",
  },
  ".cm-blockquote-line": {
    borderLeft: "3px solid var(--border)",
    color: "var(--text-muted)",
    paddingLeft: "13px",
  },
  ".cm-link": {
    color: "var(--accent)",
    textDecoration: "none",
  },
  ".cm-link:hover": {
    textDecoration: "underline",
  },
  ".cm-task-checkbox": {
    verticalAlign: "middle",
    marginRight: "4px",
    accentColor: "var(--accent)",
  },
  ".cm-wikilink": {
    color: "var(--accent)",
    cursor: "pointer",
    textDecoration: "none",
  },
  ".cm-wikilink:hover": {
    textDecoration: "underline",
  },
  ".cm-wikilink-unresolved": {
    color: "var(--accent)",
    opacity: 0.55,
    textDecoration: "underline dotted",
  },
  ".cm-wikilink-embed": {
    fontStyle: "italic",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-line": {
    padding: "0 0 0 4px",
  },
  ".cm-bare-url": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
  },
  ".cm-list-bullet": {
    color: "var(--text-muted)",
    marginRight: "2px",
  },
  ".cm-list-number": {
    color: "var(--text-muted)",
  },
  ".cm-hr-raw": {
    color: "var(--text-faint)",
  },
  ".cm-hr": {
    display: "block",
    height: "1px",
    background: "var(--border)",
    margin: "1em 0",
  },
  ".cm-table": {
    borderCollapse: "collapse",
    margin: "0.5em 0",
    fontSize: "0.95em",
  },
  ".cm-table th, .cm-table td": {
    border: "1px solid var(--border)",
    padding: "4px 10px",
    textAlign: "left",
  },
  ".cm-table th": {
    background: "var(--bg-tertiary)",
    fontWeight: "600",
  },
  ".cm-math-inline": {
    padding: "0 2px",
  },
  ".cm-math-block": {
    display: "block",
    padding: "8px 0",
    textAlign: "center",
    overflowX: "auto",
  },
  ".cm-mermaid": {
    display: "block",
    padding: "12px",
    background: "var(--bg-tertiary)",
    borderRadius: "6px",
    textAlign: "center",
    overflowX: "auto",
  },
  ".cm-mermaid-error": {
    color: "var(--danger)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.85em",
    textAlign: "left",
    whiteSpace: "pre-wrap",
  },
  ".cm-footnote-ref": {
    color: "var(--accent)",
    fontSize: "0.75em",
    verticalAlign: "super",
  },
  ".cm-footnote-ref-raw": {
    color: "var(--accent)",
  },
  ".cm-footnote-def-line": {
    color: "var(--text-muted)",
    fontSize: "0.92em",
  },
  ".cm-frontmatter-panel": {
    display: "block",
    margin: "0.5em 0",
    padding: "8px 12px",
    background: "var(--bg-tertiary)",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    cursor: "text",
  },
  ".cm-frontmatter-panel-empty": {
    color: "var(--text-faint)",
    fontSize: "0.9em",
  },
  ".cm-frontmatter-row": {
    display: "flex",
    gap: "10px",
    padding: "2px 0",
    fontSize: "0.9em",
  },
  ".cm-frontmatter-key": {
    color: "var(--text-muted)",
    minWidth: "110px",
    flexShrink: "0",
  },
  ".cm-frontmatter-value": {
    color: "var(--text-normal)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-embed": {
    display: "block",
    margin: "0.5em 0",
    padding: "2px 14px",
    borderLeft: "3px solid var(--border)",
  },
  ".cm-embed-header": {
    display: "block",
    color: "var(--text-muted)",
    fontSize: "0.85em",
    fontWeight: "600",
    textDecoration: "none",
    cursor: "pointer",
    margin: "8px 0 4px",
  },
  ".cm-embed-header:hover": {
    color: "var(--accent)",
  },
  ".cm-embed-body": {
    fontSize: "0.95em",
  },
  ".cm-embed-body p:first-child, .cm-embed-body h1:first-child, .cm-embed-body h2:first-child, .cm-embed-body h3:first-child":
    {
      marginTop: "0",
    },
  ".cm-embed-error": {
    color: "var(--danger)",
    fontStyle: "italic",
    padding: "4px 0 10px",
  },
});
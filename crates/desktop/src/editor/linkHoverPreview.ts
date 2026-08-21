import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import { readNote } from "../api/vault";
import { displayName } from "../lib/displayName";
import { stripMarkdown } from "./textStats";
import { wikilinkPlugin } from "./wikilinks";

const PREVIEW_LINES = 6;

/** Ctrl/Cmd is a modifier that only `keydown`/`keyup`/mouse-event handlers
 * observe — `hoverTooltip`'s source callback gets neither, so the held state
 * is tracked here and read back from it. Editor-instance-scoped (not
 * module-level global) would be more correct but meaningfully harder for no
 * real gain: only one editor is ever focused/hovered at a time. */
let modifierHeld = false;

function trackModifier() {
  return EditorView.domEventHandlers({
    keydown(event) {
      if (event.key === "Control" || event.key === "Meta") modifierHeld = true;
      return false;
    },
    keyup(event) {
      if (event.key === "Control" || event.key === "Meta") modifierHeld = false;
      return false;
    },
    mousemove(event) {
      modifierHeld = event.ctrlKey || event.metaKey;
      return false;
    },
    blur() {
      modifierHeld = false;
      return false;
    },
  });
}

function source(view: EditorView, pos: number): Tooltip | null {
  if (!modifierHeld) return null;
  const link = view.plugin(wikilinkPlugin)?.links.find((l) => pos >= l.start && pos <= l.end);
  if (!link?.resolvedPath) return null;
  const path = link.resolvedPath;

  return {
    pos: link.start,
    end: link.end,
    above: false,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-link-preview";
      const title = document.createElement("div");
      title.className = "cm-link-preview-title";
      title.textContent = displayName(path);
      dom.appendChild(title);
      // Shown for every link, not just ambiguous ones — cheap and it means
      // the user never has to guess where a same-named note will take them.
      const pathLine = document.createElement("div");
      pathLine.className = "cm-link-preview-path";
      pathLine.textContent = path;
      dom.appendChild(pathLine);
      const body = document.createElement("div");
      body.className = "cm-link-preview-body";
      dom.appendChild(body);

      readNote(path)
        .then((content) => {
          body.textContent = stripMarkdown(content).split("\n").filter((l) => l.trim()).slice(0, PREVIEW_LINES).join("\n");
        })
        .catch(() => {
          body.remove();
        });

      return { dom };
    },
  };
}

// `baseTheme`, not `theme` — the tooltip is portaled outside the editor's
// own scoped DOM subtree, which a regular `EditorView.theme()` rule can't
// reach (see the same note on `matchedTextTheme` in wikilinkAutocomplete.ts).
const previewTheme = EditorView.baseTheme({
  ".cm-link-preview": {
    maxWidth: "320px",
    padding: "10px 12px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
  },
  ".cm-link-preview-title": {
    fontSize: "0.85em",
    fontWeight: "600",
    color: "var(--text-normal)",
  },
  ".cm-link-preview-path": {
    fontSize: "0.75em",
    color: "var(--text-faint)",
    marginBottom: "6px",
    fontFamily: "var(--font-mono)",
  },
  ".cm-link-preview-body": {
    fontSize: "0.85em",
    color: "var(--text-muted)",
    whiteSpace: "pre-wrap",
    lineHeight: "1.5",
    maxHeight: "160px",
    overflow: "hidden",
  },
});

export function linkHoverPreview() {
  return [trackModifier(), hoverTooltip(source, { hoverTime: 300 }), previewTheme];
}

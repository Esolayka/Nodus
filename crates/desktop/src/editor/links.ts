import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { open as openShell } from "@tauri-apps/plugin-shell";

function openExternal(url: string) {
  void openShell(url).catch(() => {
    // Best-effort — an unreachable/invalid URL just does nothing visible.
  });
}

/** Ctrl/Cmd+click on a `[markdown link](url)` or a bare autolinked URL opens
 * it in the system browser. Plain clicks just move the caret, same as
 * clicking anywhere else in the text — Markdown links stay fully editable. */
export function linkClickHandler() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.ctrlKey && !event.metaKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
      while (node) {
        if (node.name === "Link") {
          const urlNode = node.getChild("URL");
          if (urlNode) {
            openExternal(view.state.sliceDoc(urlNode.from, urlNode.to));
            event.preventDefault();
            return true;
          }
        }
        if (node.name === "URL" && node.parent?.name !== "Link") {
          openExternal(view.state.sliceDoc(node.from, node.to));
          event.preventDefault();
          return true;
        }
        node = node.parent;
      }
      return false;
    },
  });
}

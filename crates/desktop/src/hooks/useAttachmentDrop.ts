import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getEditor } from "../editor/editorRegistry";
import { attachFileFromPath } from "../lib/attachments";
import { useWorkspaceStore } from "../store/workspaceStore";

function activeNotePath(): string | null {
  const state = useWorkspaceStore.getState();
  const pane = state.panes.find((p) => p.id === state.activePaneId);
  return pane?.activePath ?? null;
}

function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Dropping a file onto the window copies it into the active note's
 * attachments folder and inserts `![[...]]` at the cursor — Tauri's own
 * drag-drop event (not the browser's native one) is what carries real
 * filesystem paths. */
export function useAttachmentDrop() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const droppedPaths = event.payload.paths;
          const path = activeNotePath();
          if (!path) return;
          const view = getEditor(path);
          if (!view) return;
          void (async () => {
            for (const sourceAbsolute of droppedPaths) {
              const markdown = await attachFileFromPath(path, sourceAbsolute, basenameOf(sourceAbsolute));
              const { from, to } = view.state.selection.main;
              view.dispatch({
                changes: { from, to, insert: markdown },
                selection: { anchor: from + markdown.length },
              });
            }
          })();
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          // Not running inside a Tauri window.
        });
    } catch {
      // getCurrentWebview() itself throws synchronously outside a Tauri window.
    }
    return () => unlisten?.();
  }, []);
}

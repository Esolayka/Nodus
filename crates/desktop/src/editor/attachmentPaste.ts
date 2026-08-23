import { EditorView } from "@codemirror/view";
import { attachBytes, pastedImageName } from "../lib/attachments";

/** Pasting an image from the clipboard copies it into the attachments
 * folder and inserts `![[...]]` at the cursor, as a single insertion — the
 * same outcome as dragging a file in or the "attach file" command, just
 * for data that never had a file of its own. */
export function attachmentPaste(notePath: string) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      if (!items) return false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        void file.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer);
          void attachBytes(notePath, pastedImageName(item.type), bytes).then((markdown) => {
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: markdown },
              selection: { anchor: from + markdown.length },
            });
          });
        });
        return true;
      }
      return false;
    },
  });
}

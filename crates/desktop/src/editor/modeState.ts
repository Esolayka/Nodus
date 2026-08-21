import { StateEffect, StateField } from "@codemirror/state";

/** The three editing modes a tab can be in — remembered per open note. */
export type EditorMode = "live" | "source" | "reading";

export const setEditorMode = StateEffect.define<EditorMode>();

/** Lets extensions (live-preview, wikilinks, ...) read the current mode
 * directly from `EditorState` instead of threading a prop through, and lets
 * `EditorView.editable` derive from it without a separate dispatch. */
export const editorModeField = StateField.define<EditorMode>({
  create: () => "live",
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorMode)) return effect.value;
    }
    return value;
  },
});

export function modeChanged(transactions: readonly { effects: readonly StateEffect<unknown>[] }[]): boolean {
  return transactions.some((tr) => tr.effects.some((e) => e.is(setEditorMode)));
}

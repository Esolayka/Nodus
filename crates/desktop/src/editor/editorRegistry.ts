import type { EditorView } from "@codemirror/view";

/** One live CodeMirror instance per open note, kept alive for as long as the
 * note has a tab open anywhere — switching tabs re-parents its DOM node
 * instead of destroying and recreating it, which is what keeps undo history
 * and scroll position intact across tab switches. Also the side-channel
 * anything needs to drive an editor imperatively (the outline panel's
 * "jump to heading", mode toggles, ...). Not part of React state on
 * purpose — registering a view shouldn't cause a re-render. */
const editors = new Map<string, EditorView>();

/** Returns the existing view for `path`, creating one via `create()` if this
 * is the first time it's been opened. */
export function getOrCreateEditor(path: string, create: () => EditorView): EditorView {
  let view = editors.get(path);
  if (!view) {
    view = create();
    editors.set(path, view);
  }
  return view;
}

export function getEditor(path: string): EditorView | undefined {
  return editors.get(path);
}

/** Tears down the view for `path` for good — call only once nothing has it
 * open in any tab anymore. */
export function destroyEditor(path: string) {
  const view = editors.get(path);
  if (!view) return;
  editors.delete(path);
  view.destroy();
}

export function hasEditor(path: string): boolean {
  return editors.has(path);
}

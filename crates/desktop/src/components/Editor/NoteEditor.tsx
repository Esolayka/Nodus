import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { getEditor, getOrCreateEditor } from "../../editor/editorRegistry";
import { buildExtensions, externalUpdate } from "../../editor/markdownSetup";
import { setEditorMode } from "../../editor/modeState";
import type { FollowLink } from "../../editor/wikilinks";
import { useVaultStore } from "../../store/vaultStore";
import {
  consumePendingJump,
  jumpEditorToLine,
  useWorkspaceStore,
} from "../../store/workspaceStore";
import "./NoteEditor.css";

interface NoteEditorProps {
  path: string;
}

const onFollowLink: FollowLink = async (target, resolvedPath, newTab) => {
  if (resolvedPath) {
    await useWorkspaceStore.getState().navigateTo(resolvedPath, { newTab });
    return;
  }
  const newPath = await useVaultStore.getState().createFile("", target);
  await useWorkspaceStore.getState().navigateTo(newPath, { newTab });
};

export function NoteEditor({ path }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const updateContent = useWorkspaceStore((s) => s.updateContent);
  const flush = useWorkspaceStore((s) => s.flush);

  // One CodeMirror instance per open note, kept alive for the note's whole
  // lifetime as an open tab (see editorRegistry) — switching to it here just
  // re-parents its DOM node, which is what keeps undo history and scroll
  // position intact when you switch away and back.
  useEffect(() => {
    const view = getOrCreateEditor(path, () => {
      const initialContent = useWorkspaceStore.getState().buffers[path]?.content ?? "";
      const state = EditorState.create({
        doc: initialContent,
        extensions: buildExtensions(
          path,
          (content) => updateContent(path, content),
          () => void flush(path),
          onFollowLink,
        ),
      });
      const created = new EditorView({ state });
      const initialMode = useWorkspaceStore.getState().modes[path];
      if (initialMode && initialMode !== "live") {
        created.dispatch({ effects: setEditorMode.of(initialMode) });
      }
      return created;
    });

    containerRef.current?.appendChild(view.dom);
    const pendingLine = consumePendingJump(path);
    if (pendingLine != null) jumpEditorToLine(view, pendingLine);
    const focusHandle = requestAnimationFrame(() => view.focus());

    return () => {
      cancelAnimationFrame(focusHandle);
      view.dom.remove();
    };
    // Extensions close over `path`; each unique path gets its own view,
    // created once via the registry above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    return useWorkspaceStore.subscribe((state, prevState) => {
      const buffer = state.buffers[path];
      const prevBuffer = prevState.buffers[path];
      if (!buffer || buffer.reloadToken === prevBuffer?.reloadToken) return;
      const view = getEditor(path);
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: buffer.content },
        annotations: [externalUpdate.of(true)],
      });
    });
  }, [path]);

  return <div className="note-editor" ref={containerRef} />;
}

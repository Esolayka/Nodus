import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { getEditor, getOrCreateEditor } from "../../editor/editorRegistry";
import { buildExtensions, externalUpdate } from "../../editor/markdownSetup";
import { setEditorMode } from "../../editor/modeState";
import type { FollowLink } from "../../editor/wikilinks";
import { useVaultStore } from "../../store/vaultStore";
import { useSettingsStore } from "../../store/settingsStore";
import {
  consumePendingJump,
  jumpEditorToLine,
  useWorkspaceStore,
} from "../../store/workspaceStore";
import { EditorContextMenu } from "./EditorContextMenu";
import { InlineTitle } from "./InlineTitle";
import "./NoteEditor.css";

interface NoteEditorProps {
  path: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  view: EditorView;
}

const onFollowLink: FollowLink = async (target, resolvedPath, newTab) => {
  const shouldOpenNewTab =
    newTab || useSettingsStore.getState().settings.general.openLinksInNewTab;
  if (resolvedPath) {
    await useWorkspaceStore.getState().navigateTo(resolvedPath, {
      newTab: shouldOpenNewTab,
    });
    return;
  }
  const newPath = await useVaultStore.getState().createFile("", target);
  await useWorkspaceStore.getState().navigateTo(newPath, {
    newTab: shouldOpenNewTab,
  });
};

export function NoteEditor({ path }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
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
    const pendingJump = consumePendingJump(path);
    if (pendingJump != null) jumpEditorToLine(view, pendingJump.line, pendingJump.range);
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

  useEffect(() => {
    setContextMenu(null);
  }, [path]);

  return (
    <div className="note-editor-wrapper">
      <InlineTitle path={path} />
      <div
        className="note-editor"
        ref={containerRef}
        onContextMenu={(event) => {
          // Embedded external images have their own real action (save to
          // vault); do not cover it with the generic editor menu.
          const target = event.target instanceof Element ? event.target : null;
          if (event.defaultPrevented || target?.closest(".cm-media-embed")) return;
          const view = getEditor(path);
          if (!view) return;
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, view });
        }}
      />
      {contextMenu && (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          view={contextMenu.view}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getEditor } from "../../editor/editorRegistry";
import { extractOutline } from "../../editor/outline";
import { useWorkspaceStore } from "../../store/workspaceStore";

export function OutlinePanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const content = useWorkspaceStore((s) => s.buffers[path]?.content ?? "");
  const headings = useMemo(() => extractOutline(content), [content]);

  function jumpTo(position: number) {
    const view = getEditor(path);
    if (!view) return;
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    view.focus();
  }

  if (headings.length === 0) {
    return <p className="side-panel-empty">{t("outline.empty")}</p>;
  }

  return (
    <ul className="outline-list">
      {headings.map((h) => (
        <li key={h.position}>
          <button
            type="button"
            className="outline-item"
            style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
            onClick={() => jumpTo(h.position)}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

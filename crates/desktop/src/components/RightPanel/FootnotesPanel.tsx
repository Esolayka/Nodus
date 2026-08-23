import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getEditor } from "../../editor/editorRegistry";
import { parseFootnoteDefs } from "../../lib/footnotes";
import type { PluginContext } from "../../plugins/context";

export function FootnotesPanel({ ctx, path }: { ctx: PluginContext; path: string }) {
  const { t } = useTranslation();
  const content = ctx.workspace.useNoteContent(path);
  const defs = useMemo(() => parseFootnoteDefs(content), [content]);

  function jumpTo(position: number) {
    const view = getEditor(path);
    if (!view) return;
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    view.focus();
  }

  if (defs.length === 0) {
    return <p className="side-panel-empty">{t("plugins.footnotes.empty")}</p>;
  }

  return (
    <ul className="outline-list">
      {defs.map((def) => (
        <li key={def.id}>
          <button type="button" className="outline-item" onClick={() => jumpTo(def.position)}>
            <strong>[^{def.id}]</strong> {def.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

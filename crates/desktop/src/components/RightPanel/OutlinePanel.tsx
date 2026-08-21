import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getEditor } from "../../editor/editorRegistry";
import { extractOutline } from "../../editor/outline";
import { useWorkspaceStore } from "../../store/workspaceStore";

const DEBOUNCE_MS = 300;

export function OutlinePanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const content = useWorkspaceStore((s) => s.buffers[path]?.content ?? "");
  const [debouncedContent, setDebouncedContent] = useState(content);
  const [activePosition, setActivePosition] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [content]);

  const headings = useMemo(() => extractOutline(debouncedContent), [debouncedContent]);

  // Scroll-spy: highlight whichever heading is at or just above the top of
  // the editor's visible area, mirroring what's actually on screen.
  useEffect(() => {
    const view = getEditor(path);
    if (!view) return;
    const scroller = view.scrollDOM;

    let frame: number | null = null;
    function update() {
      if (!view) return;
      const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
      let current: number | null = null;
      for (const h of headings) {
        if (h.position <= top) current = h.position;
        else break;
      }
      setActivePosition(current);
    }
    function onScroll() {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    }
    update();
    scroller.addEventListener("scroll", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [path, headings]);

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
            className={`outline-item${h.position === activePosition ? " outline-item-active" : ""}`}
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

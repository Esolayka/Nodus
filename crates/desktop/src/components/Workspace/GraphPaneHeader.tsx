import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore, type Pane } from "../../store/workspaceStore";

export function GraphPaneHeader({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const navigateHistory = useWorkspaceStore((state) => state.navigateHistory);
  const closeView = useWorkspaceStore((state) => state.closeView);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canGoBack = pane.historyIndex > 0;
  const canGoForward =
    pane.historyIndex >= 0 && pane.historyIndex < pane.history.length - 1;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  return (
    <div className="graph-pane-header">
      <div className="graph-pane-nav">
        <button
          type="button"
          disabled={!canGoBack}
          title={t("pathBar.back")}
          onClick={() => navigateHistory(pane.id, -1)}
        >
          <ChevronLeft size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled={!canGoForward}
          title={t("pathBar.forward")}
          onClick={() => navigateHistory(pane.id, 1)}
        >
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
      </div>
      <span className="graph-pane-title">{t("graph.title")}</span>
      <div className="graph-pane-menu-wrap" ref={menuRef}>
        <button
          type="button"
          title={t("pathBar.menu")}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreVertical size={16} strokeWidth={1.75} />
        </button>
        {menuOpen && (
          <div className="graph-pane-menu">
            <button
              type="button"
              onClick={() => {
                document.dispatchEvent(new CustomEvent("nodus:graphFit"));
                setMenuOpen(false);
              }}
            >
              {t("graph.fit")}
            </button>
            <button
              type="button"
              onClick={() => {
                closeView(pane.id);
                setMenuOpen(false);
              }}
            >
              {t("workspace.closeTab")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

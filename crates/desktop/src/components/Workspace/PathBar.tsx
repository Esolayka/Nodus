import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { displayName } from "../../lib/displayName";
import { isCanvasPath } from "../../lib/canvasTypes";
import { useWorkspaceStore, type Pane } from "../../store/workspaceStore";

export function PathBar({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const navigateHistory = useWorkspaceStore((s) => s.navigateHistory);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const toggleReading = useWorkspaceStore((s) => s.toggleReading);
  const [menuOpen, setMenuOpen] = useState(false);
  const path = pane.activePath;
  const isCanvas = !!path && isCanvasPath(path);
  const readMode = useWorkspaceStore((s) => (path ? s.modes[path] === "reading" : false));

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const canGoBack = pane.historyIndex > 0;
  const canGoForward = pane.historyIndex >= 0 && pane.historyIndex < pane.history.length - 1;

  function closeOthers() {
    setMenuOpen(false);
    for (const tab of pane.tabs) {
      if (tab !== path) closeTab(pane.id, tab);
    }
  }

  function closeAll() {
    setMenuOpen(false);
    for (const tab of pane.tabs) closeTab(pane.id, tab);
  }

  async function copyPath() {
    setMenuOpen(false);
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // Clipboard unavailable — ignore.
    }
  }

  const segments = path ? path.split("/") : [];

  return (
    <div className="path-bar">
      <div className="path-bar-nav">
        <button
          type="button"
          className="path-bar-btn"
          disabled={!canGoBack}
          onClick={() => navigateHistory(pane.id, -1)}
          title={t("pathBar.back")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M10 3 5 8l5 5" />
          </svg>
        </button>
        <button
          type="button"
          className="path-bar-btn"
          disabled={!canGoForward}
          onClick={() => navigateHistory(pane.id, 1)}
          title={t("pathBar.forward")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="m6 3 5 5-5 5" />
          </svg>
        </button>
      </div>
      <div className="path-bar-crumbs">
        {segments.map((segment, i) => (
          <span key={`${segment}-${i}`} className="path-bar-crumb">
            {i > 0 && <span className="path-bar-sep">/</span>}
            {i === segments.length - 1 && path ? (
              <button
                type="button"
                className="path-bar-crumb-btn"
                onClick={() => setActiveTab(pane.id, path)}
              >
                {displayName(segment)}
              </button>
            ) : (
              <span className="path-bar-crumb-text">{segment}</span>
            )}
          </span>
        ))}
      </div>
      <div className="path-bar-actions">
        {!isCanvas && (
          <button
            type="button"
            className={`path-bar-btn${readMode ? " path-bar-btn-active" : ""}`}
            onClick={() => path && toggleReading(path)}
            title={t("pathBar.readMode")}
          >
            {readMode ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" />
                <path d="M8 6.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.8 3.2a7 7 0 0 1 0 9.6M5.5 5.5a3.5 3.5 0 0 0 0 5M3.2 3.2a7 7 0 0 0 0 9.6" />
              </svg>
            )}
          </button>
        )}
        <div className="path-bar-menu-wrap">
          <button
            type="button"
            className="path-bar-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            title={t("pathBar.menu")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M8 3v.1M8 8v.1M8 13v.1" />
            </svg>
          </button>
          {menuOpen && (
            <div className="path-bar-menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={closeOthers}>
                {t("pathBar.closeOthers")}
              </button>
              <button type="button" onClick={closeAll}>
                {t("pathBar.closeAll")}
              </button>
              <div className="menu-separator" />
              <button type="button" onClick={() => void copyPath()}>
                {t("pathBar.copyPath")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

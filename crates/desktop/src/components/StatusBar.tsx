import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api/vault";
import { charCount, wordCount } from "../editor/textStats";
import { useUiStore } from "../store/uiStore";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";

const COUNT_DEBOUNCE_MS = 400;

export function StatusBar() {
  const { t } = useTranslation();
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
  });
  const content = useWorkspaceStore((s) =>
    activePath ? (s.buffers[activePath]?.content ?? "") : "",
  );
  const dirty = useWorkspaceStore((s) => (activePath ? (s.buffers[activePath]?.dirty ?? false) : false));
  const saving = useWorkspaceStore((s) =>
    activePath ? (s.buffers[activePath]?.saving ?? false) : false,
  );
  const saveError = useWorkspaceStore((s) =>
    activePath ? (s.buffers[activePath]?.saveError ?? null) : null,
  );
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);

  const [backlinks, setBacklinks] = useState(0);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });

  useEffect(() => {
    let cancelled = false;
    if (!activePath) {
      setBacklinks(0);
      return;
    }
    api.getBacklinks(activePath).then((result) => {
      if (!cancelled) setBacklinks(result.length);
    });
    return () => {
      cancelled = true;
    };
  }, [activePath, changeVersion]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setCounts({ words: wordCount(content), chars: charCount(content) });
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [content]);

  const saveStatus = saveError
    ? t("statusBar.saveError")
    : dirty || saving
      ? t("statusBar.saving")
      : t("statusBar.saved");

  return (
    <footer className="status-bar">
      <button
        type="button"
        className="status-item"
        onClick={() => setRightPanelTab("backlinks")}
        disabled={!activePath}
      >
        {t("statusBar.backlinks", { count: backlinks })}
      </button>
      <span className="status-item">{t("statusBar.words", { count: counts.words })}</span>
      <span className="status-item">{t("statusBar.chars", { count: counts.chars })}</span>
      <span
        className={`status-item${saveError ? " status-item-error" : ""}`}
        title={saveError ?? undefined}
      >
        {saveStatus}
      </span>
    </footer>
  );
}

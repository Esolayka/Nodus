import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getBacklinks } from "../api/vault";
import { useVaultStore } from "../store/vaultStore";
import { isEmptyTab, useWorkspaceStore } from "../store/workspaceStore";

function countWords(content: string): number {
  const trimmed = content.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** The active note's stats in the status bar — backlink count, word
 * count, character count, and save state. Nothing shown at all when no
 * note is open (or a blank tab is), since none of this applies. */
export function NoteStats() {
  const { t } = useTranslation();
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    const path = pane?.activePath ?? null;
    return path && !isEmptyTab(path) ? path : null;
  });
  const buffer = useWorkspaceStore((s) => (activePath ? s.buffers[activePath] : undefined));
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const [backlinkCount, setBacklinkCount] = useState(0);

  useEffect(() => {
    if (!activePath) {
      setBacklinkCount(0);
      return;
    }
    let cancelled = false;
    getBacklinks(activePath).then((backlinks) => {
      if (!cancelled) setBacklinkCount(backlinks.length);
    });
    return () => {
      cancelled = true;
    };
  }, [activePath, changeVersion]);

  if (!activePath) return null;

  const content = buffer?.content ?? "";
  const words = countWords(content);
  const chars = content.length;

  const saveLabel = buffer?.saveError
    ? t("statusBar.saveError")
    : buffer?.saving
      ? t("statusBar.saving")
      : t("statusBar.saved");

  return (
    <>
      <span className="status-item">{t("statusBar.backlinks", { count: backlinkCount })}</span>
      <span className="status-item">{t("statusBar.words", { count: words })}</span>
      <span className="status-item">{t("statusBar.chars", { count: chars })}</span>
      <span className={buffer?.saveError ? "status-item status-item-error" : "status-item"}>{saveLabel}</span>
    </>
  );
}

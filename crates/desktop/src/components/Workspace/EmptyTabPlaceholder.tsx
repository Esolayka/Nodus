import { useTranslation } from "react-i18next";
import { labelForKeys } from "../../lib/hotkeyRegistry";
import { defaultNoteName } from "../../lib/noteNaming";
import { useUiStore } from "../../store/uiStore";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { Pane as PaneModel } from "../../store/workspaceStore";

/** What a blank "+"/Ctrl+T tab shows — distinct from "no vault is open at
 * all" (that's `AppShell`'s `workspace-empty`, a completely different
 * situation this must never be confused with). */
export function EmptyTabPlaceholder({ pane }: { pane: PaneModel }) {
  const { t } = useTranslation();
  const createFile = useVaultStore((s) => s.createFile);
  const openNote = useWorkspaceStore((s) => s.openNote);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const setQuickSwitcherOpen = useUiStore((s) => s.setQuickSwitcherOpen);

  async function handleNewFile() {
    const path = await createFile("", defaultNoteName(t("fileTree.untitled")));
    await openNote(path);
  }

  function handleClose() {
    if (pane.activePath) closeTab(pane.id, pane.activePath);
    else closePane(pane.id);
  }

  return (
    <div className="pane-empty pane-empty-tab">
      <button type="button" className="pane-empty-action" onClick={() => void handleNewFile()}>
        {t("workspace.emptyTabNewFile")}
        <span className="pane-empty-hotkey">{labelForKeys("mod+n")}</span>
      </button>
      <button type="button" className="pane-empty-action" onClick={() => setQuickSwitcherOpen(true)}>
        {t("workspace.emptyTabGoToFile")}
        <span className="pane-empty-hotkey">{labelForKeys("mod+o")}</span>
      </button>
      <button type="button" className="pane-empty-action" onClick={handleClose}>
        {t("workspace.emptyTabCloseAction")}
      </button>
    </div>
  );
}

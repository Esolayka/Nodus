import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../../store/workspaceStore";

export function ExternalChangeBar({ path }: { path: string }) {
  const { t } = useTranslation();
  const reloadFromDisk = useWorkspaceStore((s) => s.reloadFromDisk);
  const keepMine = useWorkspaceStore((s) => s.keepMine);

  return (
    <div className="external-change-bar">
      <span>{t("editor.externalChange")}</span>
      <div className="external-change-actions">
        <button type="button" onClick={() => reloadFromDisk(path)}>
          {t("editor.reload")}
        </button>
        <button type="button" onClick={() => keepMine(path)}>
          {t("editor.keepMine")}
        </button>
      </div>
    </div>
  );
}

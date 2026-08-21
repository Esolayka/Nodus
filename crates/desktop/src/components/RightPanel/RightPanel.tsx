import { useTranslation } from "react-i18next";
import { useUiStore, type RightPanelTab } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { LocalGraph } from "../Graph/LocalGraph";
import { BacklinksPanel } from "./BacklinksPanel";
import { OutlinePanel } from "./OutlinePanel";
import "./RightPanel.css";

const TABS: { id: RightPanelTab; labelKey: string }[] = [
  { id: "outline", labelKey: "rightPanel.outline" },
  { id: "backlinks", labelKey: "rightPanel.backlinks" },
  { id: "graph", labelKey: "rightPanel.graph" },
];

export function RightPanel() {
  const { t } = useTranslation();
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.setRightPanelTab);
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
  });

  return (
    <aside className="right-panel">
      <div className="right-panel-tabs">
        {TABS.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className="right-panel-body right-panel-body-nopad">
        {tab === "graph" ? (
          <LocalGraph />
        ) : !activePath ? (
          <p className="right-panel-empty">{t("rightPanel.noNote")}</p>
        ) : tab === "outline" ? (
          <OutlinePanel path={activePath} />
        ) : (
          <BacklinksPanel path={activePath} />
        )}
      </div>
    </aside>
  );
}
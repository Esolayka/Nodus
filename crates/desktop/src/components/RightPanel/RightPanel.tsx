import { useSyncExternalStore, type ComponentType } from "react";
import { List, Link2, History as HistoryIcon, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rightPanelTabRegistry } from "../../lib/rightPanelTabRegistry";
import { useUiStore, type RightPanelTab } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { LocalGraph } from "../Graph/LocalGraph";
import { Tooltip } from "../ui/Tooltip";
import { BacklinksPanel } from "./BacklinksPanel";
import { HistoryPanel } from "./HistoryPanel";
import { OutlinePanel } from "./OutlinePanel";
import "./RightPanel.css";

interface TabDescriptor {
  id: RightPanelTab;
  labelKey: string;
  icon: ComponentType<{ size?: number }>;
}

const BUILTIN_TABS: TabDescriptor[] = [
  { id: "outline", labelKey: "rightPanel.outline", icon: List },
  { id: "backlinks", labelKey: "rightPanel.backlinks", icon: Link2 },
  { id: "history", labelKey: "rightPanel.history", icon: HistoryIcon },
  { id: "graph", labelKey: "rightPanel.graph", icon: Network },
];

export function RightPanel() {
  const { t } = useTranslation();
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.setRightPanelTab);
  const pluginTabs = useSyncExternalStore(
    rightPanelTabRegistry.subscribe,
    rightPanelTabRegistry.getSnapshot,
  );
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
  });

  const tabs: TabDescriptor[] = [...BUILTIN_TABS, ...pluginTabs];

  const activePluginTab = pluginTabs.find((entry) => entry.id === tab);

  return (
    <aside className="right-panel">
      <div className="right-panel-tabs">
        {tabs.map(({ id, labelKey, icon: Icon }) => (
          <Tooltip key={id} label={t(labelKey)} placement="bottom">
            <button
              type="button"
              aria-label={t(labelKey)}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="right-panel-body right-panel-body-nopad">
        {tab === "graph" ? (
          <LocalGraph />
        ) : !activePath ? (
          <p className="right-panel-empty">{t("rightPanel.noNote")}</p>
        ) : tab === "outline" ? (
          <OutlinePanel path={activePath} />
        ) : tab === "backlinks" ? (
          <BacklinksPanel path={activePath} />
        ) : tab === "history" ? (
          <HistoryPanel path={activePath} />
        ) : activePluginTab ? (
          <activePluginTab.component path={activePath} />
        ) : null}
      </div>
    </aside>
  );
}

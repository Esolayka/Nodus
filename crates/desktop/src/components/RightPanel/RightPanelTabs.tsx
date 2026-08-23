import { useSyncExternalStore, type ComponentType } from "react";
import { History as HistoryIcon, Link2, List, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rightPanelTabRegistry } from "../../lib/rightPanelTabRegistry";
import { useUiStore, type RightPanelTab } from "../../store/uiStore";
import { Tooltip } from "../ui/Tooltip";

interface TabDescriptor {
  id: RightPanelTab;
  labelKey: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

const BUILTIN_TABS: TabDescriptor[] = [
  { id: "outline", labelKey: "rightPanel.outline", icon: List },
  { id: "backlinks", labelKey: "rightPanel.backlinks", icon: Link2 },
  { id: "history", labelKey: "rightPanel.history", icon: HistoryIcon },
  { id: "graph", labelKey: "rightPanel.graph", icon: Network },
];

export function RightPanelTabs() {
  const { t } = useTranslation();
  const tab = useUiStore((state) => state.rightPanelTab);
  const setTab = useUiStore((state) => state.setRightPanelTab);
  const pluginTabs = useSyncExternalStore(
    rightPanelTabRegistry.subscribe,
    rightPanelTabRegistry.getSnapshot,
  );
  const tabs: TabDescriptor[] = [...BUILTIN_TABS, ...pluginTabs];

  return (
    <div className="right-panel-tab-list" role="tablist">
      {tabs.map(({ id, labelKey, icon: Icon }) => (
        <Tooltip key={id} label={t(labelKey)} placement="bottom">
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-label={t(labelKey)}
            className={`titlebar-app-btn${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

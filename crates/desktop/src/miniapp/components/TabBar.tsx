import { FileText, Hash, ListChecks, Plus, Search, Settings as SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { haptic } from "../telegram";

export type Tab = "notes" | "search" | "tags" | "tasks" | "settings";

const TABS: { id: Tab; icon: ReactNode }[] = [
  { id: "notes", icon: <FileText size={18} /> },
  { id: "search", icon: <Search size={18} /> },
  { id: "tags", icon: <Hash size={18} /> },
  { id: "tasks", icon: <ListChecks size={18} /> },
  { id: "settings", icon: <SettingsIcon size={18} /> },
];

export function TabBar({ current, onChange, onQuickAdd }: { current: Tab; onChange: (tab: Tab) => void; onQuickAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="miniapp-tabbar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`miniapp-tab${current === tab.id ? " miniapp-tab-active" : ""}`}
          onClick={() => (haptic(), onChange(tab.id))}
        >
          <span className="miniapp-tab-icon">{tab.icon}</span>
          <span className="miniapp-tab-label">{t(`miniapp.tabs.${tab.id}`)}</span>
        </button>
      ))}
      <button type="button" className="miniapp-tab miniapp-tab-quickadd" onClick={() => (haptic(), onQuickAdd())}>
        <span className="miniapp-tab-icon">
          <Plus size={18} />
        </span>
        <span className="miniapp-tab-label">{t("miniapp.tabs.today")}</span>
      </button>
    </div>
  );
}

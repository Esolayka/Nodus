import { FileText, Hash, ListChecks, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";

export type Tab = "notes" | "search" | "tags" | "tasks";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "notes", label: "Notes", icon: <FileText size={19} /> },
  { id: "search", label: "Search", icon: <Search size={19} /> },
  { id: "tags", label: "Tags", icon: <Hash size={19} /> },
  { id: "tasks", label: "Tasks", icon: <ListChecks size={19} /> },
];

export function TabBar({ current, onChange, onQuickAdd }: { current: Tab; onChange: (tab: Tab) => void; onQuickAdd: () => void }) {
  return (
    <div className="miniapp-tabbar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`miniapp-tab${current === tab.id ? " miniapp-tab-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="miniapp-tab-icon">{tab.icon}</span>
          <span className="miniapp-tab-label">{tab.label}</span>
        </button>
      ))}
      <button type="button" className="miniapp-tab miniapp-tab-quickadd" onClick={onQuickAdd}>
        <span className="miniapp-tab-icon">
          <Plus size={19} />
        </span>
        <span className="miniapp-tab-label">Today</span>
      </button>
    </div>
  );
}

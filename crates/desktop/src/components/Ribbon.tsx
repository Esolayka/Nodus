import { useSyncExternalStore, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  CalendarDays,
  CopyPlus,
  FileSearch2,
  GitBranch,
  GitFork,
  Hash,
  LayoutDashboard,
  ListChecks,
  Terminal,
} from "lucide-react";
import { runCommand } from "../lib/commandRegistry";
import { sidebarViewRegistry } from "../lib/sidebarViewRegistry";
import { useUiStore } from "../store/uiStore";
import { Tooltip } from "./ui/Tooltip";
import "./Ribbon.css";

interface RibbonButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  active?: boolean;
  onClick: () => void;
}

function RibbonButton({ label, icon: Icon, active = false, onClick }: RibbonButtonProps) {
  return (
    <Tooltip label={label} placement="right" delay={350}>
      <button
        type="button"
        className={`ribbon-btn${active ? " ribbon-btn-active" : ""}`}
        aria-label={label}
        aria-pressed={active || undefined}
        onClick={onClick}
      >
        <Icon size={18} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}

export function Ribbon() {
  const { t } = useTranslation();
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarView = useUiStore((s) => s.setSidebarView);
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const allPluginSidebarViews = useSyncExternalStore(sidebarViewRegistry.subscribe, sidebarViewRegistry.getSnapshot);
  // Bookmarks live in the title bar. Every other plugin view stays
  // reachable below the built-in ribbon actions.
  const pluginSidebarViews = allPluginSidebarViews.filter((view) => view.id !== "core.bookmarks");

  function showSidebarView(view: string) {
    if (!sidebarCollapsed && sidebarView === view) {
      toggleSidebarCollapsed();
    } else {
      setSidebarView(view);
      if (sidebarCollapsed) toggleSidebarCollapsed();
    }
  }

  return (
    <nav className="ribbon" aria-label={t("ribbon.navigation")}>
      <div className="ribbon-group ribbon-command-group">
        <RibbonButton
          label={t("ribbon.quickSwitcher")}
          icon={FileSearch2}
          onClick={() => runCommand("app.quickSwitcher")}
        />
        <RibbonButton
          label={t("ribbon.graph")}
          icon={GitFork}
          onClick={() => runCommand("app.openGraph")}
        />
        <RibbonButton
          label={t("ribbon.newCanvas")}
          icon={LayoutDashboard}
          onClick={() => runCommand("canvas.new")}
        />
        <RibbonButton
          label={t("ribbon.todayNote")}
          icon={CalendarDays}
          onClick={() => runCommand("dailyNotes.openToday")}
        />
        <RibbonButton
          label={t("ribbon.insertTemplate")}
          icon={CopyPlus}
          onClick={() => runCommand("templates.insertAtCursor")}
        />
        <RibbonButton
          label={t("ribbon.commandPalette")}
          icon={Terminal}
          onClick={() => runCommand("app.commandPalette")}
        />
      </div>

      <div className="ribbon-separator" aria-hidden="true" />

      <div className="ribbon-group ribbon-view-group">
        <RibbonButton
          label={t("tags.title")}
          icon={Hash}
          active={!sidebarCollapsed && sidebarView === "tags"}
          onClick={() => showSidebarView("tags")}
        />
        <RibbonButton
          label={t("tasks.title")}
          icon={ListChecks}
          active={!sidebarCollapsed && sidebarView === "tasks"}
          onClick={() => showSidebarView("tasks")}
        />
        <RibbonButton
          label={t("calendar.title")}
          icon={Calendar}
          active={!sidebarCollapsed && sidebarView === "calendar"}
          onClick={() => showSidebarView("calendar")}
        />
        <RibbonButton
          label={t("git.title")}
          icon={GitBranch}
          active={!sidebarCollapsed && sidebarView === "sync"}
          onClick={() => showSidebarView("sync")}
        />
        {pluginSidebarViews.map(({ id, titleKey, icon }) => (
          <RibbonButton
            key={id}
            label={t(titleKey)}
            icon={icon}
            active={!sidebarCollapsed && sidebarView === id}
            onClick={() => showSidebarView(id)}
          />
        ))}
      </div>
    </nav>
  );
}

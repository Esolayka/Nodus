import type { ComponentType } from "react";
import { createRegistry, type RegistryEntry } from "./registry";

/** A sidebar view contributed by a plugin — same slot the built-in views
 * (files/search/tags/tasks/calendar/sync) already occupy, just reachable by
 * plugins instead of hardcoded into `AppShell`/`Ribbon`. Built-ins stay
 * hardcoded (they're not going anywhere and touching that code isn't worth
 * the risk); this registry only carries the additional, toggleable ones. */
export interface SidebarViewEntry extends RegistryEntry {
  /** i18n key for both the ribbon tooltip and the sidebar header. */
  titleKey: string;
  icon: ComponentType<{ size?: number }>;
  component: ComponentType;
}

export const sidebarViewRegistry = createRegistry<SidebarViewEntry>();

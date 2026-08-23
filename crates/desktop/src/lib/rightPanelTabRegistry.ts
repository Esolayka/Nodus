import type { ComponentType } from "react";
import { createRegistry, type RegistryEntry } from "./registry";

/** A right-panel tab contributed by a plugin — same slot the built-in tabs
 * (outline/backlinks/history/graph) already occupy. Built-ins stay
 * hardcoded in `RightPanel.tsx`; this registry only carries the rest. */
export interface RightPanelTabEntry extends RegistryEntry {
  labelKey: string;
  icon: ComponentType<{ size?: number }>;
  /** Rendered only while a real note is active — same gating the built-in
   * tabs already get from `RightPanel`. */
  component: ComponentType<{ path: string }>;
}

export const rightPanelTabRegistry = createRegistry<RightPanelTabEntry>();

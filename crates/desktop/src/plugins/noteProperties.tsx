import { LayoutList } from "lucide-react";
import { AllPropertiesPanel } from "../components/Properties/AllPropertiesPanel";
import type { NodusPlugin } from "./types";

/** Two panels, as spec'd: the inline editable frontmatter widget (always
 * present in `editor/frontmatter.ts`, gated by this same plugin id's
 * enabled flag read directly off the settings store — an editor-level
 * StateField isn't something this registry-based host can enable/disable
 * itself) and this vault-wide browsable view, the one actually registered
 * here. */
export const notePropertiesPlugin: NodusPlugin = {
  id: "core.noteProperties",
  nameKey: "plugins.noteProperties.name",
  descriptionKey: "plugins.noteProperties.description",
  tier: "isolated",
  defaultEnabled: true,
  onEnable(ctx) {
    return ctx.registerSidebarView({
      id: "core.allProperties",
      order: 40,
      titleKey: "plugins.noteProperties.allTitle",
      icon: LayoutList,
      component: () => <AllPropertiesPanel ctx={ctx} />,
    });
  },
};

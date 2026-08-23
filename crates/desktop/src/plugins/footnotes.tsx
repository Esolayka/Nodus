import { Superscript } from "lucide-react";
import { FootnotesPanel } from "../components/RightPanel/FootnotesPanel";
import type { NodusPlugin } from "./types";

export const footnotesPlugin: NodusPlugin = {
  id: "core.footnotes",
  nameKey: "plugins.footnotes.name",
  descriptionKey: "plugins.footnotes.description",
  tier: "isolated",
  defaultEnabled: true,
  onEnable(ctx) {
    return ctx.registerRightPanelTab({
      id: "core.footnotes",
      order: 60,
      labelKey: "plugins.footnotes.tabLabel",
      icon: Superscript,
      component: ({ path }) => <FootnotesPanel ctx={ctx} path={path} />,
    });
  },
};

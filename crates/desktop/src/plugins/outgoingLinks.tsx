import { OutgoingLinksPanel } from "../components/RightPanel/OutgoingLinksPanel";
import type { NodusPlugin } from "./types";

export const outgoingLinksPlugin: NodusPlugin = {
  id: "core.outgoingLinks",
  nameKey: "plugins.outgoingLinks.name",
  descriptionKey: "plugins.outgoingLinks.description",
  tier: "isolated",
  defaultEnabled: true,
  onEnable(ctx) {
    return ctx.registerRightPanelTab({
      id: "core.outgoingLinks",
      order: 50,
      labelKey: "plugins.outgoingLinks.tabLabel",
      component: ({ path }) => <OutgoingLinksPanel ctx={ctx} path={path} />,
    });
  },
};

import { useState, useSyncExternalStore } from "react";
import { ArrowDownAZ, ArrowUpAZ, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rightPanelTabRegistry } from "../../lib/rightPanelTabRegistry";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { LocalGraph } from "../Graph/LocalGraph";
import { Tooltip } from "../ui/Tooltip";
import { BacklinksPanel } from "./BacklinksPanel";
import { HistoryPanel } from "./HistoryPanel";
import { OutlinePanel } from "./OutlinePanel";
import "./RightPanel.css";

export function RightPanel() {
  const { t } = useTranslation();
  const tab = useUiStore((s) => s.rightPanelTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortReversed, setSortReversed] = useState(false);
  const pluginTabs = useSyncExternalStore(
    rightPanelTabRegistry.subscribe,
    rightPanelTabRegistry.getSnapshot,
  );
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
  });

  const activePluginTab = pluginTabs.find((entry) => entry.id === tab);
  const hasListTools = tab === "outline" || tab === "backlinks";

  return (
    <aside className="right-panel">
      <div className="right-panel-toolbar">
        {hasListTools && (
          <>
            <Tooltip label={t("fileTree.sort")} placement="bottom">
              <button
                type="button"
                aria-label={t("fileTree.sort")}
                className={sortReversed ? "active" : ""}
                onClick={() => setSortReversed((value) => !value)}
              >
                {sortReversed ? (
                  <ArrowUpAZ size={16} strokeWidth={1.75} />
                ) : (
                  <ArrowDownAZ size={16} strokeWidth={1.75} />
                )}
              </button>
            </Tooltip>
            <Tooltip label={t("search.title")} placement="bottom">
              <button
                type="button"
                aria-label={t("search.title")}
                className={searchOpen ? "active" : ""}
                onClick={() => {
                  setSearchOpen((value) => !value);
                  if (searchOpen) setQuery("");
                }}
              >
                {searchOpen ? (
                  <X size={16} strokeWidth={1.75} />
                ) : (
                  <Search size={16} strokeWidth={1.75} />
                )}
              </button>
            </Tooltip>
          </>
        )}
      </div>
      {searchOpen && hasListTools && (
        <label className="right-panel-search">
          <input
            autoFocus
            type="search"
            value={query}
            placeholder={t("graph.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      <div className="right-panel-body right-panel-body-nopad">
        {tab === "graph" ? (
          <LocalGraph />
        ) : !activePath ? (
          <p className="right-panel-empty">{t("rightPanel.noNote")}</p>
        ) : tab === "outline" ? (
          <OutlinePanel path={activePath} query={query} reversed={sortReversed} />
        ) : tab === "backlinks" ? (
          <BacklinksPanel path={activePath} query={query} reversed={sortReversed} />
        ) : tab === "history" ? (
          <HistoryPanel path={activePath} />
        ) : activePluginTab ? (
          <activePluginTab.component path={activePath} />
        ) : null}
      </div>
    </aside>
  );
}

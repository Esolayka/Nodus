import { useEffect, useState } from "react";
import { QuickAddSheet } from "./components/QuickAddSheet";
import { SyncIndicator } from "./components/SyncIndicator";
import { TabBar, type Tab } from "./components/TabBar";
import { EditorScreen } from "./screens/EditorScreen";
import { LinkScreen } from "./screens/LinkScreen";
import { NoteListScreen } from "./screens/NoteListScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TagsScreen } from "./screens/TagsScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { useLinkStore } from "./store/linkStore";
import { useMiniAppThemeStore } from "./store/themeStore";
import { flushQueue } from "./sync";
import { applyMiniAppTheme, initTelegram } from "./telegram";
import "./MiniApp.css";

type Screen = { view: "main" } | { view: "editor"; path: string };

const FLUSH_RETRY_MS = 30_000;

export function MiniApp() {
  const linked = useLinkStore((s) => s.linked);
  const themePreference = useMiniAppThemeStore((s) => s.preference);
  const [tab, setTab] = useState<Tab>("notes");
  const [screen, setScreen] = useState<Screen>({ view: "main" });
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | undefined>(undefined);

  useEffect(() => {
    initTelegram();
  }, []);

  // Re-applies whenever the user flips the Appearance setting, not just on
  // mount — switching preference is meant to take effect immediately.
  useEffect(() => {
    applyMiniAppTheme(themePreference);
  }, [themePreference]);

  useEffect(() => {
    if (!linked) return;
    const tryFlush = () => void flushQueue();
    window.addEventListener("online", tryFlush);
    const interval = setInterval(tryFlush, FLUSH_RETRY_MS);
    tryFlush();
    return () => {
      window.removeEventListener("online", tryFlush);
      clearInterval(interval);
    };
  }, [linked]);

  if (!linked) return <LinkScreen />;

  if (screen.view === "editor") {
    return (
      <EditorScreen
        path={screen.path}
        onBack={() => setScreen({ view: "main" })}
        onNavigate={(path) => setScreen({ view: "editor", path })}
      />
    );
  }

  return (
    <div className="miniapp-shell">
      <SyncIndicator />
      <div className="miniapp-content">
        {tab === "notes" && <NoteListScreen onOpen={(path) => setScreen({ view: "editor", path })} />}
        {tab === "search" && (
          <SearchScreen initialQuery={searchQuery} onOpen={(path) => setScreen({ view: "editor", path })} />
        )}
        {tab === "tags" && (
          <TagsScreen
            onOpenTag={(tag) => {
              setSearchQuery(`tag:${tag}`);
              setTab("search");
            }}
          />
        )}
        {tab === "tasks" && <TasksScreen onOpen={(path) => setScreen({ view: "editor", path })} />}
        {tab === "settings" && <SettingsScreen />}
      </div>
      <TabBar current={tab} onChange={setTab} onQuickAdd={() => setQuickAddOpen(true)} />
      {quickAddOpen && <QuickAddSheet onClose={() => setQuickAddOpen(false)} />}
    </div>
  );
}

import { useEffect, useState } from "react";
import { QuickAddSheet } from "./components/QuickAddSheet";
import { SyncIndicator } from "./components/SyncIndicator";
import { TabBar, type Tab } from "./components/TabBar";
import { EditorScreen } from "./screens/EditorScreen";
import { LinkScreen } from "./screens/LinkScreen";
import { NoteListScreen } from "./screens/NoteListScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { TagsScreen } from "./screens/TagsScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { useLinkStore } from "./store/linkStore";
import { flushQueue } from "./sync";
import { applyTelegramTheme, initTelegram } from "./telegram";
import "./MiniApp.css";

type Screen = { view: "main" } | { view: "editor"; path: string };

const FLUSH_RETRY_MS = 30_000;

export function MiniApp() {
  const linked = useLinkStore((s) => s.linked);
  const [tab, setTab] = useState<Tab>("notes");
  const [screen, setScreen] = useState<Screen>({ view: "main" });
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    applyTelegramTheme();
    initTelegram();
  }, []);

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
        {tab === "search" && <SearchScreen onOpen={(path) => setScreen({ view: "editor", path })} />}
        {tab === "tags" && <TagsScreen onOpenTag={() => setTab("search")} />}
        {tab === "tasks" && <TasksScreen onOpen={(path) => setScreen({ view: "editor", path })} />}
      </div>
      <TabBar current={tab} onChange={setTab} onQuickAdd={() => setQuickAddOpen(true)} />
      {quickAddOpen && <QuickAddSheet onClose={() => setQuickAddOpen(false)} />}
    </div>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setHistorySettings, telegramSetBotToken, telegramSetManualAddress } from "../api/vault";
import { displayName } from "../lib/displayName";
import { registerBuiltinCommands } from "../lib/builtinCommands";
import { registerCommand } from "../lib/commandRegistry";
import { openTodayNote } from "../lib/dailyNotes";
import { labelForKeys } from "../lib/hotkeyRegistry";
import { defaultNoteName } from "../lib/noteNaming";
import { sidebarViewRegistry } from "../lib/sidebarViewRegistry";
import { ensureTagIndexSubscribed } from "../lib/tagIndexCache";
import { ALL_PLUGINS } from "../plugins";
import { pluginHost } from "../plugins/host";
import { useServerSyncStore } from "../store/serverSyncStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSyncStore } from "../store/syncStore";
import { useUiStore } from "../store/uiStore";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore, isEmptyTab } from "../store/workspaceStore";
import { useGlobalHotkeys } from "../hooks/useGlobalHotkeys";
import { useMruTabCycling } from "../hooks/useMruTabCycling";
import { useOpenVaultFolder } from "../hooks/useOpenVaultFolder";
import { useVaultEvents } from "../hooks/useVaultEvents";
import "./AppShell.css";
import { CalendarPanel } from "./Calendar/CalendarPanel";
import { CommandPalette } from "./CommandPalette/CommandPalette";
import { UnusedAttachmentsDialog } from "./Attachments/UnusedAttachmentsDialog";
import { QuickNoteDialog } from "./DailyNotes/QuickNoteDialog";
import { FileTree } from "./FileTree/FileTree";
import { GitPanel } from "./Git/GitPanel";
import { ObsidianImportDialog } from "./Import/ObsidianImportDialog";
import { ImageLightbox } from "./Media/ImageLightbox";
import { ServerSyncPanel } from "./ServerSync/ServerSyncPanel";
import { QuickSwitcher } from "./QuickSwitcher/QuickSwitcher";
import { Ribbon } from "./Ribbon";
import { RightPanel } from "./RightPanel/RightPanel";
import { SearchPanel } from "./Search/SearchPanel";
import { SettingsModal } from "./Settings/SettingsModal";
import { StatusBar } from "./StatusBar";
import { TagsPanel } from "./Tags/TagsPanel";
import { TasksPanel } from "./Tasks/TasksPanel";
import { TemplateFlowDialog } from "./Templates/TemplateFlowDialog";
import { TitleBar } from "./TitleBar";
import { Tooltip } from "./ui/Tooltip";
import { VaultSwitcher } from "./VaultSwitcher";
import { PaneGroup } from "./Workspace/PaneGroup";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 500;
const SIDEBAR_DEFAULT = 270;
const RIGHT_PANEL_MIN = 220;
const RIGHT_PANEL_MAX = 500;
const RIGHT_PANEL_DEFAULT = 290;

export function AppShell() {
  const { t, i18n } = useTranslation();
  const tree = useVaultStore((s) => s.tree);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const isLoading = useVaultStore((s) => s.isLoading);
  const error = useVaultStore((s) => s.error);
  const open = useVaultStore((s) => s.open);
  const restoreLast = useVaultStore((s) => s.restoreLast);
  const createFile = useVaultStore((s) => s.createFile);
  const createFolder = useVaultStore((s) => s.createFolder);
  const openNote = useWorkspaceStore((s) => s.openNote);
  const settings = useSettingsStore((s) => s.settings);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const templateDialog = useUiStore((s) => s.templateDialog);
  const setTemplateDialog = useUiStore((s) => s.setTemplateDialog);
  const quickNoteOpen = useUiStore((s) => s.quickNoteOpen);
  const setQuickNoteOpen = useUiStore((s) => s.setQuickNoteOpen);
  const lightboxImageSrc = useUiStore((s) => s.lightboxImageSrc);
  const setLightboxImageSrc = useUiStore((s) => s.setLightboxImageSrc);
  const unusedAttachmentsOpen = useUiStore((s) => s.unusedAttachmentsOpen);
  const { openFolder, obsidianImport, closeObsidianImport } = useOpenVaultFolder();
  const setUnusedAttachmentsOpen = useUiStore((s) => s.setUnusedAttachmentsOpen);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT);
  const rightResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const pluginSidebarViews = useSyncExternalStore(sidebarViewRegistry.subscribe, sidebarViewRegistry.getSnapshot);
  const activePluginSidebarView = pluginSidebarViews.find((v) => v.id === sidebarView);

  useVaultEvents();
  useGlobalHotkeys();
  useMruTabCycling();

  useEffect(() => {
    ensureTagIndexSubscribed();
    const unregisterBuiltins = registerBuiltinCommands();
    const unregisterGraph = registerCommand({
      id: "app.openGraph",
      title: t("commands.openGraph"),
      hotkeyLabel: labelForKeys("mod+g"),
      run: () => useWorkspaceStore.getState().openGraph(),
    });
    pluginHost.start(ALL_PLUGINS);
    return () => {
      unregisterBuiltins();
      unregisterGraph();
      pluginHost.stop();
    };
    // Registers once at startup — commands close over live store getters,
    // not stale snapshots, so they don't need to be re-created on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeNotePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    const path = pane?.activePath ?? null;
    return path && !isEmptyTab(path) ? path : null;
  });

  useEffect(() => {
    const title = activeNotePath
      ? `${displayName(activeNotePath)} — Nodus`
      : "Nodus";
    document.title = title;
    try {
      void getCurrentWindow().setTitle(title);
    } catch {
      // Title updates are best-effort in non-Tauri contexts.
    }
  }, [activeNotePath]);

  useEffect(() => {
    void restoreLast().then(() => {
      if (useSettingsStore.getState().settings.dailyNotes.openOnStartup && useVaultStore.getState().tree) {
        void openTodayNote();
      }
    });
    // Runs once on startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush every unsaved buffer before the window actually closes — a plain
  // `close()` would just re-fire this same event, so the async work runs
  // first and `destroy()` (not `close()`) does the real, final close.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await useWorkspaceStore.getState().flushAll();
            await getCurrentWindow().destroy();
          } catch (error) {
            // Not just a log: if destroy() itself fails (e.g. a missing
            // capability), the window never actually closes and the user
            // is left clicking a dead button with no idea why.
            console.error("[app] failed to close window:", error);
          }
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          // Running outside a Tauri window — nothing to intercept.
        });
    } catch {
      // getCurrentWindow() itself throws synchronously outside a Tauri window.
    }
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${settings.editor.fontSize}px`,
    );
  }, [settings.editor.fontSize]);

  useEffect(() => {
    if (i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language);
    }
  }, [i18n, settings.language]);

  useEffect(() => {
    if (vaultPath) void setHistorySettings(settings.history);
  }, [vaultPath, settings.history]);

  // Turning Git sync on (or opening a vault while it's already on) opens/
  // initializes the repo at the vault root and, if configured, pulls once —
  // a fresh vault's first fetch shouldn't require a manual click.
  useEffect(() => {
    if (vaultPath && settings.sync.mechanism === "git") {
      const git = settings.sync.git;
      void (async () => {
        await useSyncStore.getState().enableGit(vaultPath);
        if (useSyncStore.getState().enabled && git.autopullOnStartup && git.remoteUrl) {
          await useSyncStore.getState().pull(git.remoteName, git.branch);
        }
      })();
    } else {
      useSyncStore.getState().reset();
    }
    // Only the vault or the chosen mechanism should re-trigger this — editing
    // other Git settings shouldn't force a fresh enable/pull cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, settings.sync.mechanism]);

  // Scheduled autocommit — only armed while Git is the active mechanism and
  // the user explicitly opted into "on a schedule" rather than manual commits.
  useEffect(() => {
    const { mechanism, git } = settings.sync;
    if (mechanism !== "git" || git.autocommit !== "scheduled") return;
    const intervalMs = Math.max(1, git.autocommitIntervalMinutes) * 60_000;
    const handle = setInterval(() => {
      if (!useSyncStore.getState().enabled) return;
      const message = git.commitMessageTemplate.replace("%date%", new Date().toLocaleString());
      void useSyncStore.getState().commit(message, git.authorName || "Nodus", git.authorEmail || "nodus@localhost");
    }, intervalMs);
    return () => clearInterval(handle);
  }, [settings.sync]);

  // Enabling the "Nodus server" mechanism (or opening a vault while it's
  // already on and already paired) connects and syncs once immediately —
  // matches the Git backend's own "don't require a manual first click"
  // behavior above.
  useEffect(() => {
    const server = settings.sync.server;
    if (vaultPath && settings.sync.mechanism === "server" && server.token) {
      void (async () => {
        await useServerSyncStore.getState().enable(vaultPath, server.baseUrl, server.token, server.deviceName);
        if (useServerSyncStore.getState().enabled) {
          await useServerSyncStore.getState().syncOnce();
        }
      })();
    } else {
      useServerSyncStore.getState().reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, settings.sync.mechanism, settings.sync.server.token]);

  // Scheduled sync — only armed while the server mechanism is active and
  // the user opted into "on a schedule" rather than syncing manually.
  useEffect(() => {
    const { mechanism, server } = settings.sync;
    if (mechanism !== "server" || server.autoSync !== "scheduled") return;
    const intervalMs = Math.max(1, server.autoSyncIntervalMinutes) * 60_000;
    const handle = setInterval(() => {
      if (!useServerSyncStore.getState().enabled) return;
      void useServerSyncStore.getState().syncOnce();
    }, intervalMs);
    return () => clearInterval(handle);
  }, [settings.sync]);

  // Keeps the running local-mode HTTP server's bot token in sync with
  // settings — it needs the current value to verify every linking
  // attempt, not just whatever was configured when the app started.
  useEffect(() => {
    if (settings.telegram.enabled && settings.telegram.placement === "local" && settings.telegram.botToken) {
      void telegramSetBotToken(settings.telegram.botToken);
    }
  }, [settings.telegram.enabled, settings.telegram.placement, settings.telegram.botToken]);

  useEffect(() => {
    if (settings.telegram.enabled && settings.telegram.placement === "local" && settings.telegram.manualAddress) {
      void telegramSetManualAddress(settings.telegram.manualAddress);
    }
  }, [settings.telegram.enabled, settings.telegram.placement, settings.telegram.manualAddress]);

  async function handleNewNote() {
    const path = await createFile("", defaultNoteName(t("fileTree.untitled")));
    await openNote(path);
  }

  async function handleNewFolder() {
    await createFolder("", t("fileTree.newFolderName"));
  }

  function startResize(e: React.MouseEvent) {
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const width = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, resizeRef.current.startWidth + ev.clientX - resizeRef.current.startX),
      );
      setSidebarWidth(width);
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startRightResize(e: React.MouseEvent) {
    rightResizeRef.current = { startX: e.clientX, startWidth: rightPanelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!rightResizeRef.current) return;
      const width = Math.min(
        RIGHT_PANEL_MAX,
        Math.max(
          RIGHT_PANEL_MIN,
          rightResizeRef.current.startWidth + rightResizeRef.current.startX - ev.clientX,
        ),
      );
      setRightPanelWidth(width);
    };
    const onUp = () => {
      rightResizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const effectiveSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth;
  // The right sidebar is application chrome, not vault content. Its toggle
  // is always present in the title bar, so the panel itself must also be
  // available while a vault is loading or when no vault is open yet.
  const effectiveRightPanelWidth = rightPanelCollapsed ? 0 : rightPanelWidth;
  const columns = `var(--ribbon-width) ${effectiveSidebarWidth}px ${sidebarCollapsed ? "0px" : "4px"} 1fr ${rightPanelCollapsed ? "0px" : "4px"} ${effectiveRightPanelWidth}px`;

  return (
    <div
      className={tree ? "app-shell" : "app-shell no-vault"}
      style={{ gridTemplateColumns: columns }}
    >
      <TitleBar />
      <Ribbon
        onOpenFolder={() => void openFolder()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {!sidebarCollapsed && (
        <aside className="sidebar">
          {sidebarView === "files" && (
            <div className="sidebar-actions">
              <Tooltip label={t("fileTree.newNote")} placement="right">
                <button type="button" onClick={() => void handleNewNote()}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip label={t("fileTree.newFolder")} placement="right">
                <button type="button" onClick={() => void handleNewFolder()}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h2.5l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v5.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7z" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip label={t("fileTree.sort")} placement="right">
                <button type="button" onClick={() => document.dispatchEvent(new CustomEvent("nodus:toggleSort"))}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M4 3v10M4 13 1.5 10.5M4 13l2.5-2.5M12 13V3M12 3l2.5 2.5M12 3 9.5 5.5" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip label={t("fileTree.collapseAll")} placement="right">
                <button type="button" onClick={() => document.dispatchEvent(new CustomEvent("nodus:collapseAll"))}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M4 6.5 8 3l4 3.5M4 13l4-3.5 4 3.5" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          )}
          {sidebarView === "search" ? (
            <SearchPanel />
          ) : sidebarView === "tags" ? (
            <TagsPanel />
          ) : sidebarView === "tasks" ? (
            <TasksPanel />
          ) : sidebarView === "calendar" ? (
            <CalendarPanel />
          ) : sidebarView === "sync" ? (
            settings.sync.mechanism === "server" ? (
              <ServerSyncPanel />
            ) : (
              <GitPanel />
            )
          ) : activePluginSidebarView ? (
            <activePluginSidebarView.component />
          ) : tree ? (
            <FileTree />
          ) : (
            <div className="sidebar-empty">
              {isLoading ? t("sidebar.loading") : t("sidebar.emptyState")}
            </div>
          )}
          <div className="sidebar-footer">
            <VaultSwitcher
              vaultPath={vaultPath}
              onOpenAnother={() => void openFolder()}
            />
            <div className="sidebar-footer-actions">
              <Tooltip label={t("sidebar.help")} placement="top">
                <button type="button" className="sidebar-icon-btn">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M6.2 6.2a1.8 1.8 0 1 1 2.7 1.6c-.7.4-.9.7-.9 1.4" />
                    <path d="M8 11.8v.1" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip label={t("settings.title")} placement="top">
                <button
                  type="button"
                  className="sidebar-icon-btn"
                  onClick={() => setSettingsOpen(true)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <circle cx="8" cy="8" r="2" />
                    <path d="M13 8.5a5 5 0 0 0-.1-1l1.4-1.1-.9-1.6-1.6.6a5 5 0 0 0-1.7-1L9.8 1.7H7.6l-.3 1.7a5 5 0 0 0-1.7 1l-1.6-.6-.9 1.6 1.4 1.1a5 5 0 0 0 0 2l-1.4 1.1.9 1.6 1.6-.6a5 5 0 0 0 1.7 1l.3 1.7h2.2l.3-1.7a5 5 0 0 0 1.7-1l1.6.6.9-1.6-1.4-1.1a5 5 0 0 0 .1-1z" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>
        </aside>
      )}
      {!sidebarCollapsed && <div className="sidebar-resizer" onMouseDown={startResize} />}
      <main className="workspace">
        {tree ? (
          <PaneGroup />
        ) : (
          <div className="workspace-empty">
            <p className="workspace-placeholder">{t("workspace.placeholder")}</p>
            <button type="button" onClick={() => void openFolder()}>
              {t("sidebar.openFolder")}
            </button>
            {error && <p className="workspace-error">{error}</p>}
          </div>
        )}
        <StatusBar />
      </main>
      {!rightPanelCollapsed && (
        <div className="right-panel-resizer" onMouseDown={startRightResize} />
      )}
      {!rightPanelCollapsed && <RightPanel />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <CommandPalette />
      <QuickSwitcher />
      {templateDialog && <TemplateFlowDialog mode={templateDialog} onClose={() => setTemplateDialog(null)} />}
      {quickNoteOpen && <QuickNoteDialog onClose={() => setQuickNoteOpen(false)} />}
      {lightboxImageSrc && (
        <ImageLightbox src={lightboxImageSrc} onClose={() => setLightboxImageSrc(null)} />
      )}
      {unusedAttachmentsOpen && (
        <UnusedAttachmentsDialog onClose={() => setUnusedAttachmentsOpen(false)} />
      )}
      {obsidianImport && (
        <ObsidianImportDialog
          path={obsidianImport.path}
          inspection={obsidianImport.inspection}
          onOpen={(path) => void open(path)}
          onClose={closeObsidianImport}
        />
      )}
    </div>
  );
}

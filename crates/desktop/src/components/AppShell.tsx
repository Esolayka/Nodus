import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pickVaultFolder } from "../api/vault";
import { displayName } from "../lib/displayName";
import { useSettingsStore } from "../store/settingsStore";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useVaultEvents } from "../hooks/useVaultEvents";
import "./AppShell.css";
import { FileTree } from "./FileTree/FileTree";
import { Ribbon } from "./Ribbon";
import { RightPanel } from "./RightPanel/RightPanel";
import { SettingsModal } from "./Settings/SettingsModal";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { Tooltip } from "./ui/Tooltip";
import { PaneGroup } from "./Workspace/PaneGroup";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 500;
const SIDEBAR_DEFAULT = 300;

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useVaultEvents();

  const activeNotePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
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
    void restoreLast();
    // Runs once on startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        e.preventDefault();
        useWorkspaceStore.getState().openGraph();
      } else if (key === "e") {
        e.preventDefault();
        const state = useWorkspaceStore.getState();
        const pane = state.panes.find((p) => p.id === state.activePaneId);
        if (pane?.activePath) state.toggleLiveSource(pane.activePath);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
          await useWorkspaceStore.getState().flushAll();
          await getCurrentWindow().destroy();
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

  async function handleOpenFolder() {
    const path = await pickVaultFolder();
    if (path) await open(path);
  }

  async function handleNewNote() {
    const path = await createFile("", t("fileTree.untitled"));
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

  const vaultName = vaultPath ? vaultPath.split(/[\\/]/).pop() : "";

  const columns = tree ? `44px ${sidebarWidth}px 4px 1fr 280px` : `44px 300px 4px 1fr`;

  return (
    <div
      className={tree ? "app-shell" : "app-shell no-vault"}
      style={{ gridTemplateColumns: columns }}
    >
      <TitleBar />
      <Ribbon
        onOpenFolder={() => void handleOpenFolder()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <aside className="sidebar">
        <div className="sidebar-header">{vaultName}</div>
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
        </div>
        {tree ? (
          <FileTree />
        ) : (
          <div className="sidebar-empty">
            {isLoading ? t("sidebar.loading") : t("sidebar.emptyState")}
          </div>
        )}
        <div className="sidebar-footer">
          <span className="sidebar-vault-path" title={vaultPath ?? ""}>
            {vaultPath ?? ""}
          </span>
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
      <div className="sidebar-resizer" onMouseDown={startResize} />
      <main className="workspace">
        {tree ? (
          <PaneGroup />
        ) : (
          <div className="workspace-empty">
            <p className="workspace-placeholder">{t("workspace.placeholder")}</p>
            <button type="button" onClick={() => void handleOpenFolder()}>
              {t("sidebar.openFolder")}
            </button>
            {error && <p className="workspace-error">{error}</p>}
          </div>
        )}
      </main>
      {tree && <RightPanel />}
      <StatusBar />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import * as api from "../api/vault";
import { destroyEditor, getEditor } from "../editor/editorRegistry";
import { type EditorMode, setEditorMode } from "../editor/modeState";
import { useNoteUsageStore } from "./noteUsageStore";
import type { FsChange } from "../types/vault";

export interface Buffer {
  path: string;
  content: string;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  /** True while `content` was reloaded from disk and hasn't reached the editor yet. */
  reloadToken: number;
  /** Set when the file changed on disk while this buffer had unsaved edits —
   * the fresh disk content sits in `conflictContent` until the user picks
   * "reload" or "keep mine" (never applied silently). */
  externalConflict: boolean;
  conflictContent: string | null;
}

/** A non-file view hosted inside a pane (like Obsidian's graph leaf). */
export type WorkspaceView = "graph";

export interface Pane {
  id: string;
  tabs: string[];
  activePath: string | null;
  view: WorkspaceView | null;
  /** Navigation history for the path bar's back/forward arrows. */
  history: string[];
  historyIndex: number;
}

interface WorkspaceState {
  panes: Pane[];
  activePaneId: string;
  buffers: Record<string, Buffer>;
  /** Per-note editing mode, remembered for as long as the note stays open
   * anywhere (mirrors the one-CodeMirror-instance-per-note model). */
  modes: Record<string, EditorMode>;
  /** The mode to return to when leaving "reading" — whichever of
   * live/source was active right before. */
  lastEditModes: Record<string, "live" | "source">;

  openNote: (path: string, opts?: { split?: boolean }) => Promise<void>;
  openGraph: (opts?: { split?: boolean }) => void;
  setActiveView: (paneId: string, view: WorkspaceView) => void;
  closeView: (paneId: string) => void;
  closeTab: (paneId: string, path: string) => void;
  setActiveTab: (paneId: string, path: string) => void;
  setActivePane: (paneId: string) => void;
  closePane: (paneId: string) => void;
  closePath: (path: string) => void;
  navigateHistory: (paneId: string, delta: number) => void;
  updateContent: (path: string, content: string) => void;
  flush: (path: string) => Promise<void>;
  flushAll: () => Promise<void>;
  handleExternalChange: (change: FsChange) => Promise<void>;
  handleRenamed: (oldPath: string, newPath: string) => void;
  setMode: (path: string, mode: EditorMode) => void;
  toggleReading: (path: string) => void;
  toggleLiveSource: (path: string) => void;
  reloadFromDisk: (path: string) => void;
  keepMine: (path: string) => void;
  /** Opens `path` (in the current pane) and moves the cursor to `line`
   * (1-indexed) — used by the backlinks panel's click-to-open-at-line. */
  jumpToLine: (path: string, line: number) => Promise<void>;
  /** Following a wikilink: plain click replaces what's showing in the
   * current tab (`newTab: false`), Ctrl/Cmd+click and the middle mouse
   * button open a separate new tab instead. */
  navigateTo: (path: string, opts?: { newTab?: boolean }) => Promise<void>;
}

const AUTOSAVE_DELAY_MS = 500;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// A jump requested before the target note's CodeMirror instance exists yet
// (opening a note mounts its editor asynchronously, via `NoteEditor`'s own
// effect) — `NoteEditor` applies and clears this once its view is ready,
// rather than this module polling for it.
let pendingJump: { path: string; line: number } | null = null;

export function consumePendingJump(path: string): number | null {
  if (pendingJump?.path !== path) return null;
  const line = pendingJump.line;
  pendingJump = null;
  return line;
}

export function jumpEditorToLine(view: EditorView, line: number) {
  const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
  const lineInfo = view.state.doc.line(clamped);
  view.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
  view.focus();
}

function makePaneId(): string {
  return crypto.randomUUID();
}

function firstPane(): Pane {
  return { id: makePaneId(), tabs: [], activePath: null, view: null, history: [], historyIndex: -1 };
}

/** Records a navigation step: truncates the forward history and appends `path`. */
function pushHistory(pane: Pane, path: string): { history: string[]; historyIndex: number } {
  if (pane.history[pane.historyIndex] === path) {
    return { history: pane.history, historyIndex: pane.historyIndex };
  }
  const history = pane.history.slice(0, pane.historyIndex + 1);
  history.push(path);
  return { history, historyIndex: history.length - 1 };
}

/** Removes `path` from history and keeps the index pointing at a valid entry. */
function dropFromHistory(pane: Pane, path: string): { history: string[]; historyIndex: number } {
  const removedIndex = pane.history.indexOf(path);
  if (removedIndex === -1) return { history: pane.history, historyIndex: pane.historyIndex };
  const history = pane.history.filter((p) => p !== path);
  let historyIndex = pane.historyIndex;
  if (removedIndex < historyIndex) historyIndex -= 1;
  else if (removedIndex === historyIndex) historyIndex = Math.max(0, historyIndex - 1);
  historyIndex = Math.min(historyIndex, history.length - 1);
  return { history, historyIndex };
}

/** Whether `path` is still open as a tab in any pane. */
function isStillOpen(panes: Pane[], path: string): boolean {
  return panes.some((p) => p.tabs.includes(path));
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  panes: [firstPane()],
  activePaneId: "",
  buffers: {},
  modes: {},
  lastEditModes: {},

  openNote: async (path, opts) => {
    const state = get();
    const activePaneId = state.activePaneId || state.panes[0].id;

    let targetPaneId = activePaneId;
    if (opts?.split) {
      const newPane: Pane = firstPane();
      set((s) => ({ panes: [...s.panes, newPane] }));
      targetPaneId = newPane.id;
    }

    if (!state.buffers[path]) {
      const content = await api.readNote(path);
      set((s) => ({
        buffers: {
          ...s.buffers,
          [path]: {
            path,
            content,
            dirty: false,
            saving: false,
            saveError: null,
            reloadToken: 0,
            externalConflict: false,
            conflictContent: null,
          },
        },
      }));
    }

    set((s) => ({
      activePaneId: targetPaneId,
      panes: s.panes.map((pane) =>
        pane.id === targetPaneId
          ? {
              ...pane,
              ...pushHistory(pane, path),
              view: null,
              tabs: pane.tabs.includes(path) ? pane.tabs : [...pane.tabs, path],
              activePath: path,
            }
          : pane,
      ),
    }));
    useNoteUsageStore.getState().recordOpen(path);
  },

  navigateTo: async (path, opts) => {
    if (opts?.newTab) {
      await get().openNote(path);
      return;
    }

    const state = get();
    const activePaneId = state.activePaneId || state.panes[0].id;
    const pane = state.panes.find((p) => p.id === activePaneId);
    const fromPath = pane?.activePath ?? null;
    if (fromPath === path) return;

    if (!state.buffers[path]) {
      const content = await api.readNote(path);
      set((s) => ({
        buffers: {
          ...s.buffers,
          [path]: {
            path,
            content,
            dirty: false,
            saving: false,
            saveError: null,
            reloadToken: 0,
            externalConflict: false,
            conflictContent: null,
          },
        },
      }));
    }

    set((s) => ({
      activePaneId,
      panes: s.panes.map((p) => {
        if (p.id !== activePaneId) return p;
        // Replaces the tab we're navigating away from with the target,
        // rather than leaving it open alongside — that's what makes this
        // "the current tab" instead of always-open-a-new-one. If the
        // target is already open somewhere in this pane, just switch to it.
        const tabs = p.tabs.includes(path)
          ? p.tabs
          : fromPath && p.tabs.includes(fromPath)
            ? p.tabs.map((t) => (t === fromPath ? path : t))
            : [...p.tabs, path];
        return { ...p, ...pushHistory(p, path), view: null, tabs, activePath: path };
      }),
    }));
    useNoteUsageStore.getState().recordOpen(path);
  },

  openGraph: (opts) => {
    const state = get();
    const activePaneId = state.activePaneId || state.panes[0].id;

    let targetPaneId = activePaneId;
    if (opts?.split) {
      const newPane: Pane = firstPane();
      set((s) => ({ panes: [...s.panes, newPane] }));
      targetPaneId = newPane.id;
    }

    set((s) => ({
      activePaneId: targetPaneId,
      panes: s.panes.map((pane) =>
        pane.id === targetPaneId ? { ...pane, view: "graph" } : pane,
      ),
    }));
  },

  setActiveView: (paneId, view) => {
    set((s) => ({
      activePaneId: paneId,
      panes: s.panes.map((pane) =>
        pane.id === paneId ? { ...pane, view } : pane,
      ),
    }));
  },

  closeView: (paneId) => {
    set((s) => ({
      panes: s.panes.map((pane) =>
        pane.id === paneId ? { ...pane, view: null } : pane,
      ),
    }));
  },

  closeTab: (paneId, path) => {
    set((s) => {
      const panes = s.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        const tabs = pane.tabs.filter((t) => t !== path);
        const activePath =
          pane.activePath === path ? (tabs[tabs.length - 1] ?? null) : pane.activePath;
        return { ...pane, tabs, activePath, ...dropFromHistory(pane, path) };
      });
      return { panes };
    });
    void get().flush(path);
    if (!isStillOpen(get().panes, path)) {
      destroyEditor(path);
      set((s) => {
        const modes = { ...s.modes };
        const lastEditModes = { ...s.lastEditModes };
        delete modes[path];
        delete lastEditModes[path];
        return { modes, lastEditModes };
      });
    }
  },

  setActiveTab: (paneId, path) => {
    set((s) => ({
      activePaneId: paneId,
      panes: s.panes.map((pane) =>
        pane.id === paneId
          ? { ...pane, ...pushHistory(pane, path), view: null, activePath: path }
          : pane,
      ),
    }));
  },

  setActivePane: (paneId) => set({ activePaneId: paneId }),

  navigateHistory: (paneId, delta) => {
    set((s) => ({
      activePaneId: paneId,
      panes: s.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        const index = Math.min(
          Math.max(pane.historyIndex + delta, 0),
          pane.history.length - 1,
        );
        const path = pane.history[index];
        if (!path || index === pane.historyIndex) return pane;
        return {
          ...pane,
          view: null,
          historyIndex: index,
          activePath: path,
          tabs: pane.tabs.includes(path) ? pane.tabs : [...pane.tabs, path],
        };
      }),
    }));
  },

  closePane: (paneId) => {
    const closingPane = get().panes.find((p) => p.id === paneId);
    set((s) => {
      if (s.panes.length === 1) return s;
      const panes = s.panes.filter((p) => p.id !== paneId);
      const activePaneId =
        s.activePaneId === paneId ? panes[panes.length - 1].id : s.activePaneId;
      return { panes, activePaneId };
    });
    for (const path of closingPane?.tabs ?? []) {
      void get().flush(path);
      if (!isStillOpen(get().panes, path)) destroyEditor(path);
    }
  },

  updateContent: (path, content) => {
    set((s) => ({
      buffers: {
        ...s.buffers,
        [path]: { ...s.buffers[path], content, dirty: true, saveError: null },
      },
    }));

    const existing = saveTimers.get(path);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      path,
      setTimeout(() => {
        saveTimers.delete(path);
        void get().flush(path);
      }, AUTOSAVE_DELAY_MS),
    );
  },

  flush: async (path) => {
    const buffer = get().buffers[path];
    if (!buffer || !buffer.dirty || buffer.saving) return;
    const timer = saveTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(path);
    }
    const content = buffer.content;
    set((s) => ({ buffers: { ...s.buffers, [path]: { ...s.buffers[path], saving: true } } }));
    try {
      await api.writeNote(path, content);
      set((s) => {
        const current = s.buffers[path];
        if (!current) return s;
        return {
          buffers: {
            ...s.buffers,
            [path]: {
              ...current,
              saving: false,
              saveError: null,
              dirty: current.content !== content ? current.dirty : false,
            },
          },
        };
      });
    } catch (error) {
      set((s) => ({
        buffers: {
          ...s.buffers,
          [path]: { ...s.buffers[path], saving: false, saveError: String(error) },
        },
      }));
    }
  },

  flushAll: async () => {
    await Promise.all(Object.keys(get().buffers).map((path) => get().flush(path)));
  },

  handleExternalChange: async (change) => {
    if (change.kind === "removed") {
      get().closePath(change.path);
      return;
    }

    const buffer = get().buffers[change.path];
    if (!buffer) return;
    const content = await api.readNote(change.path);
    if (buffer.dirty) {
      set((s) => ({
        buffers: {
          ...s.buffers,
          [change.path]: { ...s.buffers[change.path], externalConflict: true, conflictContent: content },
        },
      }));
      return;
    }
    set((s) => ({
      buffers: {
        ...s.buffers,
        [change.path]: {
          ...s.buffers[change.path],
          content,
          reloadToken: s.buffers[change.path].reloadToken + 1,
        },
      },
    }));
  },

  reloadFromDisk: (path) => {
    set((s) => {
      const buffer = s.buffers[path];
      if (!buffer?.conflictContent) return s;
      return {
        buffers: {
          ...s.buffers,
          [path]: {
            ...buffer,
            content: buffer.conflictContent,
            dirty: false,
            externalConflict: false,
            conflictContent: null,
            reloadToken: buffer.reloadToken + 1,
          },
        },
      };
    });
  },

  keepMine: (path) => {
    set((s) => {
      const buffer = s.buffers[path];
      if (!buffer) return s;
      return {
        buffers: {
          ...s.buffers,
          [path]: { ...buffer, externalConflict: false, conflictContent: null },
        },
      };
    });
    void get().flush(path);
  },

  jumpToLine: async (path, line) => {
    await get().openNote(path);
    const view = getEditor(path);
    if (view) {
      jumpEditorToLine(view, line);
    } else {
      pendingJump = { path, line };
    }
  },

  /** Closes every open tab/buffer for `path` itself and, since it may be a
   * folder, anything nested under it. Used both for external removals and
   * for deletions the app itself initiated (those are suppressed from the
   * watcher as self-writes, so no `vault:changed` event comes back for them). */
  closePath: (path) => {
    const matches = (p: string) => p === path || p.startsWith(`${path}/`);
    const affected = Object.keys(get().buffers).filter(matches);
    set((s) => {
      const buffers = { ...s.buffers };
      for (const p of Object.keys(buffers)) {
        if (matches(p)) delete buffers[p];
      }
      return {
        buffers,
        panes: s.panes.map((pane) => {
          const tabs = pane.tabs.filter((t) => !matches(t));
          let nextPane = {
            ...pane,
            tabs,
            activePath:
              pane.activePath && matches(pane.activePath)
                ? (tabs[tabs.length - 1] ?? null)
                : pane.activePath,
          };
          const removed = nextPane.history.filter((p) => matches(p));
          if (removed.length > 0) {
            nextPane = { ...nextPane, ...dropFromHistory(nextPane, removed[0]) };
          }
          return nextPane;
        }),
      };
    });
    for (const p of affected) destroyEditor(p);
  },

  handleRenamed: (oldPath, newPath) => {
    const remap = (p: string) =>
      p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p;
    set((s) => {
      const buffers: Record<string, Buffer> = {};
      for (const [p, buf] of Object.entries(s.buffers)) {
        const newP = remap(p);
        buffers[newP] = newP === p ? buf : { ...buf, path: newP };
      }
      const modes: Record<string, EditorMode> = {};
      for (const [p, mode] of Object.entries(s.modes)) modes[remap(p)] = mode;
      const lastEditModes: Record<string, "live" | "source"> = {};
      for (const [p, mode] of Object.entries(s.lastEditModes)) lastEditModes[remap(p)] = mode;
      return {
        buffers,
        modes,
        lastEditModes,
        panes: s.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map(remap),
          activePath: pane.activePath ? remap(pane.activePath) : pane.activePath,
        })),
      };
    });
    useNoteUsageStore.getState().rename(oldPath, newPath);
  },

  setMode: (path, mode) => {
    set((s) => ({ modes: { ...s.modes, [path]: mode } }));
    if (mode !== "reading") {
      set((s) => ({ lastEditModes: { ...s.lastEditModes, [path]: mode } }));
    }
    const view = getEditor(path);
    if (view) view.dispatch({ effects: setEditorMode.of(mode) });
  },

  toggleReading: (path) => {
    const state = get();
    const current = state.modes[path] ?? "live";
    if (current === "reading") {
      state.setMode(path, state.lastEditModes[path] ?? "live");
    } else {
      state.setMode(path, "reading");
    }
  },

  toggleLiveSource: (path) => {
    const state = get();
    const current = state.modes[path] ?? "live";
    if (current === "reading") return; // Ctrl+E only toggles between live/source.
    state.setMode(path, current === "live" ? "source" : "live");
  },
}));

useWorkspaceStore.setState((s) => ({ activePaneId: s.panes[0].id }));

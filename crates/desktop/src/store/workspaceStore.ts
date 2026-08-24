import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import * as api from "../api/vault";
import { destroyEditor, getEditor } from "../editor/editorRegistry";
import { type EditorMode, setEditorMode } from "../editor/modeState";
import { useNoteUsageStore } from "./noteUsageStore";
import { useVaultStore } from "./vaultStore";
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

/** A leading space plus "empty:" — chosen specifically so it can never
 * collide with a real vault-relative path (paths never start with a
 * space), without needing to change `activePath`/`tabs`'s string type
 * anywhere they're already consumed. Backs the "+"/Ctrl+T blank-tab
 * pattern: a tab that exists with no file behind it yet. */
export const EMPTY_TAB_PREFIX = " empty:";
/** Synthetic id used only in a pane's visual tab order. Like the empty-tab
 * prefix, the leading space prevents collision with a vault-relative path. */
export const GRAPH_TAB_ID = " view:graph";
export const TAB_ANIMATION_MS = 160;

export function tabAnimationKey(paneId: string, tabId: string): string {
  return `${paneId}\u0000${tabId}`;
}

function withoutClosingTab(closingTabs: Record<string, true>, key: string): Record<string, true> {
  if (!closingTabs[key]) return closingTabs;
  const next = { ...closingTabs };
  delete next[key];
  return next;
}

export function isEmptyTab(path: string | null): path is string {
  return path != null && path.startsWith(EMPTY_TAB_PREFIX);
}

export function makeEmptyTabId(): string {
  return `${EMPTY_TAB_PREFIX}${crypto.randomUUID()}`;
}

export interface Pane {
  id: string;
  tabs: string[];
  /** Visual order of note/empty tabs plus `GRAPH_TAB_ID`. `tabs` remains
   * the file-only list used by buffer and close-path logic. */
  tabOrder: string[];
  activePath: string | null;
  view: WorkspaceView | null;
  /** Whether a graph tab exists in this pane at all — independent of
   * `view`, which only tracks which special view is currently in front.
   * Keeping this separate is what lets the graph be a real tab (closable,
   * doesn't block other tabs from opening) instead of a pane-wide
   * exclusive mode. */
  graphOpen: boolean;
  /** Navigation history for the path bar's back/forward arrows. */
  history: string[];
  historyIndex: number;
  /** Most-recently-used tab order (index 0 = most recent) — Ctrl+Tab
   * cycles through this, not tab position, per spec. Separate from
   * `history`: clicking back to an already-open tab is a "recent use" but
   * not a new history entry. */
  mru: string[];
}

interface WorkspaceState {
  panes: Pane[];
  activePaneId: string;
  buffers: Record<string, Buffer>;
  /** Tabs stay mounted briefly after a close command so their chrome can
   * contract before the pane removes them from its canonical tab lists. */
  closingTabs: Record<string, true>;
  /** Per-note editing mode, remembered for as long as the note stays open
   * anywhere (mirrors the one-CodeMirror-instance-per-note model). */
  modes: Record<string, EditorMode>;
  /** The mode to return to when leaving "reading" — whichever of
   * live/source was active right before. */
  lastEditModes: Record<string, "live" | "source">;

  openNote: (path: string, opts?: { split?: boolean; pdfPage?: number }) => Promise<void>;
  /** "+" and Ctrl+T: a blank tab with no file behind it yet — replaced
   * in-place the moment the user actually opens or creates a note from it,
   * not left orphaned alongside a real one. */
  openEmptyTab: (opts?: { split?: boolean }) => void;
  openGraph: (opts?: { split?: boolean }) => void;
  /** Bumped every time a pending PDF-page jump is queued, so `PdfViewerTab`
   * re-runs its "consume the pending page" effect even when the same page
   * is requested twice in a row. */
  pdfJumpVersion: number;
  setActiveView: (paneId: string, view: WorkspaceView) => void;
  closeView: (paneId: string) => void;
  closeTab: (paneId: string, path: string) => void;
  reorderTab: (paneId: string, tabId: string, toIndex: number) => void;
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
   * (1-indexed) — used by the backlinks panel's click-to-open-at-line.
   * `range` (char offsets within that line) selects and briefly flashes a
   * specific match instead of just placing the cursor, for the search panel. */
  jumpToLine: (path: string, line: number, range?: [number, number]) => Promise<void>;
  /** Following a wikilink: plain click replaces what's showing in the
   * current tab (`newTab: false`), Ctrl/Cmd+click and the middle mouse
   * button open a separate new tab instead. */
  navigateTo: (path: string, opts?: { newTab?: boolean }) => Promise<void>;
  /** Ctrl+Tab / Ctrl+Shift+Tab: step +1 or -1 through the pane's
   * most-recently-used tab order. */
  cycleMru: (paneId: string, step: 1 | -1) => void;
  /** Called on Ctrl release to fold the cycling session's result into the
   * front of the MRU list. */
  commitMruCycle: (paneId: string) => void;
}

const AUTOSAVE_DELAY_MS = 500;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface PendingJump {
  path: string;
  line: number;
  /** Char-offset range within that line to select (and briefly flash) —
   * from the search panel's "highlight the match for a couple of seconds"
   * requirement — instead of just placing the cursor. */
  range?: [number, number];
}

// A jump requested before the target note's CodeMirror instance exists yet
// (opening a note mounts its editor asynchronously, via `NoteEditor`'s own
// effect) — `NoteEditor` applies and clears this once its view is ready,
// rather than this module polling for it.
let pendingJump: PendingJump | null = null;

export function consumePendingJump(path: string): PendingJump | null {
  if (pendingJump?.path !== path) return null;
  const jump = pendingJump;
  pendingJump = null;
  return jump;
}

// Same idea as `pendingJump`, for the PDF viewer's own notion of position
// (a page number, not a CodeMirror line) — set by `openNote`'s `pdfPage`
// option, consumed once `PdfViewerTab` has computed a real row height to
// scroll to.
let pendingPdfPage: { path: string; page: number } | null = null;

export function consumePendingPdfPage(path: string): number | null {
  if (pendingPdfPage?.path !== path) return null;
  const page = pendingPdfPage.page;
  pendingPdfPage = null;
  return page;
}

const HIGHLIGHT_FLASH_MS = 2000;

export function jumpEditorToLine(view: EditorView, line: number, range?: [number, number]) {
  const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
  const lineInfo = view.state.doc.line(clamped);
  if (range) {
    const from = lineInfo.from + Math.min(range[0], lineInfo.length);
    const to = lineInfo.from + Math.min(range[1], lineInfo.length);
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
    setTimeout(() => {
      // Collapse back to a cursor once the flash window has passed — only
      // if the selection is still what we set (the user hasn't since
      // clicked/typed elsewhere).
      if (view.state.selection.main.from === from && view.state.selection.main.to === to) {
        view.dispatch({ selection: { anchor: to } });
      }
    }, HIGHLIGHT_FLASH_MS);
  } else {
    view.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
    view.focus();
  }
}

function makePaneId(): string {
  return crypto.randomUUID();
}

function firstPane(): Pane {
  // Starts with one real empty tab (not zero tabs) so the tab bar always
  // shows something to click, matching Obsidian's "New tab" — an app with
  // no tabs open at all isn't a state Obsidian ever shows.
  const tabId = makeEmptyTabId();
  return {
    id: makePaneId(),
    tabs: [tabId],
    tabOrder: [tabId],
    activePath: tabId,
    view: null,
    graphOpen: false,
    history: [],
    historyIndex: -1,
    mru: [],
  };
}

/** Returns a complete, duplicate-free order even if a pane came from an
 * older in-memory shape or an operation appended a tab before updating the
 * order. This keeps tab chrome resilient while `tabs` remains the canonical
 * list of actual files. */
export function orderedPaneTabIds(pane: Pane): string[] {
  const available = new Set(pane.tabs);
  if (pane.graphOpen) available.add(GRAPH_TAB_ID);
  const order: string[] = [];
  for (const id of pane.tabOrder ?? []) {
    if (available.delete(id)) order.push(id);
  }
  for (const path of pane.tabs) {
    if (available.delete(path)) order.push(path);
  }
  if (available.delete(GRAPH_TAB_ID)) order.push(GRAPH_TAB_ID);
  return order;
}

function replaceOrderedTab(order: string[], from: string, to: string): string[] {
  const replaced = order.map((id) => (id === from ? to : id));
  return replaced.filter((id, index) => replaced.indexOf(id) === index);
}

/** Moves `path` to the front of the MRU list, dropping any earlier
 * occurrence — called on every "real" activation (not on Ctrl+Tab cycling
 * itself, which deliberately leaves this order alone until the cycle ends,
 * or nothing would be left to cycle *through*). */
function touchMru(pane: Pane, path: string): string[] {
  return [path, ...pane.mru.filter((p) => p !== path)];
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
  closingTabs: {},
  modes: {},
  lastEditModes: {},
  pdfJumpVersion: 0,

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

    if (opts?.pdfPage != null) {
      pendingPdfPage = { path, page: opts.pdfPage };
      set((s) => ({ pdfJumpVersion: s.pdfJumpVersion + 1 }));
    }

    set((s) => ({
      activePaneId: targetPaneId,
      panes: s.panes.map((pane) => {
        if (pane.id !== targetPaneId) return pane;
        // A blank "+"/Ctrl+T tab (or a freshly split pane's starting blank
        // tab) gets replaced in place instead of leaving an orphaned empty
        // tab sitting next to the real one — only the sentinel itself,
        // never a real path.
        const replacing = isEmptyTab(pane.activePath) ? pane.activePath : null;
        const tabs = replacing
          ? pane.tabs.map((t) => (t === replacing ? path : t))
          : pane.tabs.includes(path)
            ? pane.tabs
            : [...pane.tabs, path];
        const mru = replacing ? pane.mru.filter((p) => p !== replacing) : pane.mru;
        const tabOrder = replacing
          ? replaceOrderedTab(pane.tabOrder, replacing, path)
          : pane.tabs.includes(path)
            ? pane.tabOrder
            : [...pane.tabOrder, path];
        return {
          ...pane,
          ...pushHistory(pane, path),
          view: null,
          tabs,
          tabOrder,
          activePath: path,
          mru: touchMru({ ...pane, mru }, path),
        };
      }),
    }));
    useNoteUsageStore.getState().recordOpen(path);
  },

  openEmptyTab: (opts) => {
    const state = get();
    const activePaneId = state.activePaneId || state.panes[0].id;

    let targetPaneId = activePaneId;
    if (opts?.split) {
      const newPane: Pane = firstPane();
      set((s) => ({ panes: [...s.panes, newPane] }));
      targetPaneId = newPane.id;
    }

    const tabId = makeEmptyTabId();
    set((s) => ({
      activePaneId: targetPaneId,
      panes: s.panes.map((pane) =>
        pane.id === targetPaneId
          ? {
              ...pane,
              view: null,
              tabs: [...pane.tabs, tabId],
              tabOrder: [...pane.tabOrder, tabId],
              activePath: tabId,
              mru: touchMru(pane, tabId),
            }
          : pane,
      ),
    }));
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
        const tabOrder = p.tabs.includes(path)
          ? p.tabOrder
          : fromPath && p.tabs.includes(fromPath)
            ? replaceOrderedTab(p.tabOrder, fromPath, path)
            : [...p.tabOrder, path];
        return {
          ...p,
          ...pushHistory(p, path),
          view: null,
          tabs,
          tabOrder,
          activePath: path,
          mru: touchMru(p, path),
        };
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
        pane.id === targetPaneId
          ? {
              ...pane,
              view: "graph",
              graphOpen: true,
              tabOrder: pane.graphOpen ? pane.tabOrder : [...pane.tabOrder, GRAPH_TAB_ID],
            }
          : pane,
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
    const key = tabAnimationKey(paneId, GRAPH_TAB_ID);
    const state = get();
    const pane = state.panes.find((candidate) => candidate.id === paneId);
    if (!pane?.graphOpen || state.closingTabs[key]) return;

    set((s) => ({ closingTabs: { ...s.closingTabs, [key]: true } }));
    setTimeout(() => {
      set((s) => ({
        closingTabs: withoutClosingTab(s.closingTabs, key),
        panes: s.panes.map((pane) => {
          if (pane.id !== paneId || !pane.graphOpen) return pane;
          const tabOrder = pane.tabOrder.filter((id) => id !== GRAPH_TAB_ID);
          if (pane.tabs.length > 0) {
            const activePath = pane.activePath && pane.tabs.includes(pane.activePath)
              ? pane.activePath
              : pane.tabs[pane.tabs.length - 1];
            return { ...pane, view: null, graphOpen: false, tabOrder, activePath };
          }

          // Closing a lone graph leaf must return to Obsidian's permanent
          // "New tab" state, never to a pane with no tabs at all.
          const emptyTab = makeEmptyTabId();
          return {
            ...pane,
            tabs: [emptyTab],
            tabOrder: [...tabOrder, emptyTab],
            activePath: emptyTab,
            view: null,
            graphOpen: false,
          };
        }),
      }));
    }, TAB_ANIMATION_MS);
  },

  closeTab: (paneId, path) => {
    const key = tabAnimationKey(paneId, path);
    const state = get();
    const pane = state.panes.find((candidate) => candidate.id === paneId);
    if (!pane?.tabs.includes(path) || state.closingTabs[key]) return;

    set((s) => ({ closingTabs: { ...s.closingTabs, [key]: true } }));
    void get().flush(path);
    setTimeout(() => {
      set((s) => {
        const closingTabs = withoutClosingTab(s.closingTabs, key);
        const panes = s.panes.map((pane) => {
          if (pane.id !== paneId || !pane.tabs.includes(path)) return pane;
          const tabs = pane.tabs.filter((t) => t !== path);
          const activePath =
            pane.activePath === path ? (tabs[tabs.length - 1] ?? null) : pane.activePath;
          const tabOrder = pane.tabOrder.filter((id) => id !== path);
          const history = dropFromHistory(pane, path);

          if (tabs.length === 0 && !pane.graphOpen) {
            // Keep the tab strip structurally present after its final file or
            // blank tab is closed. This also keeps the tab-list chevron in the
            // title bar instead of collapsing the whole center area.
            const emptyTab = makeEmptyTabId();
            return {
              ...pane,
              tabs: [emptyTab],
              tabOrder: [...tabOrder, emptyTab],
              activePath: emptyTab,
              view: null,
              mru: pane.mru.filter((p) => p !== path),
              ...history,
            };
          }

          return {
            ...pane,
            tabs,
            tabOrder,
            activePath,
            // If the last file tab closes while a graph tab exists, bring
            // that existing tab forward rather than showing an empty pane.
            view: tabs.length === 0 && pane.graphOpen ? "graph" : pane.view,
            mru: pane.mru.filter((p) => p !== path),
            ...history,
          };
        });
        return { closingTabs, panes };
      });
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
    }, TAB_ANIMATION_MS);
  },

  reorderTab: (paneId, tabId, toIndex) => {
    set((s) => ({
      panes: s.panes.map((pane) => {
        if (pane.id !== paneId) return pane;
        const current = orderedPaneTabIds(pane);
        const fromIndex = current.indexOf(tabId);
        if (fromIndex === -1) return pane;
        const next = current.filter((id) => id !== tabId);
        const index = Math.min(Math.max(toIndex, 0), next.length);
        next.splice(index, 0, tabId);
        return { ...pane, tabOrder: next };
      }),
    }));
  },

  setActiveTab: (paneId, path) => {
    set((s) => ({
      activePaneId: paneId,
      panes: s.panes.map((pane) =>
        pane.id === paneId
          ? { ...pane, ...pushHistory(pane, path), view: null, activePath: path, mru: touchMru(pane, path) }
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
          tabOrder: pane.tabs.includes(path) ? pane.tabOrder : [...pane.tabOrder, path],
          mru: touchMru(pane, path),
        };
      }),
    }));
  },

  /** Ctrl+Tab: `step` +1/-1 walks forward/backward through the pane's MRU
   * list, finding wherever the current tab sits in it each time — the list
   * itself isn't reordered mid-cycle (see `touchMru`'s doc comment), so
   * repeated presses keep advancing instead of just toggling the same two
   * tabs back and forth. */
  cycleMru: (paneId, step) => {
    set((s) => ({
      panes: s.panes.map((pane) => {
        if (pane.id !== paneId || pane.mru.length < 2) return pane;
        const currentIndex = pane.activePath ? pane.mru.indexOf(pane.activePath) : -1;
        const nextIndex =
          ((currentIndex === -1 ? 0 : currentIndex) + step + pane.mru.length) % pane.mru.length;
        const nextPath = pane.mru[nextIndex];
        return { ...pane, view: null, activePath: nextPath };
      }),
    }));
  },

  /** Ends an MRU-cycling session (Ctrl released): folds wherever the pane
   * landed back into the front of the MRU list, so the *next* Ctrl+Tab
   * session starts fresh from there. */
  commitMruCycle: (paneId) => {
    set((s) => ({
      panes: s.panes.map((pane) => {
        if (pane.id !== paneId || !pane.activePath) return pane;
        return { ...pane, mru: touchMru(pane, pane.activePath) };
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
      // The disk watcher deliberately suppresses the app's own writes (so
      // saving doesn't make the editor reload its own just-saved content
      // out from under the cursor) — which also means changeVersion never
      // bumps from an in-app save on its own. Views that key off it purely
      // for "did the vault's derived data change" (graph, etc.) would
      // otherwise stay stale until an external change or a fresh mount.
      useVaultStore.getState().bumpChangeVersion();
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

  jumpToLine: async (path, line, range) => {
    await get().openNote(path);
    const view = getEditor(path);
    if (view) {
      jumpEditorToLine(view, line, range);
    } else {
      pendingJump = { path, line, range };
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
            tabOrder: pane.tabOrder.filter((id) => !matches(id)),
            activePath:
              pane.activePath && matches(pane.activePath)
                ? (tabs[tabs.length - 1] ?? null)
                : pane.activePath,
            mru: pane.mru.filter((p) => !matches(p)),
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
          tabOrder: pane.tabOrder.map(remap).filter((id, index, order) => order.indexOf(id) === index),
          activePath: pane.activePath ? remap(pane.activePath) : pane.activePath,
          history: pane.history.map(remap),
          mru: pane.mru.map(remap),
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

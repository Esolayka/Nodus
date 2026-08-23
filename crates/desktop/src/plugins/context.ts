import { useEffect, useState } from "react";
import { getAllProperties, getBookmarks, getOutgoingLinks } from "../api/vault";
import { registerCommand } from "../lib/commandRegistry";
import { setNoteNameProvider } from "../lib/noteNaming";
import { rightPanelTabRegistry } from "../lib/rightPanelTabRegistry";
import { sidebarViewRegistry } from "../lib/sidebarViewRegistry";
import { useBookmarksCacheStore } from "../store/bookmarksStore";
import { isEmptyTab, useWorkspaceStore } from "../store/workspaceStore";
import { useVaultStore } from "../store/vaultStore";
import type { OutgoingLink, PropertyRow } from "../types/vault";

/** The public API surface every plugin gets — the only thing a plugin file
 * (or its registered components) is allowed to touch. No plugin imports
 * `useVaultStore`/`useWorkspaceStore` directly: everything reactive here is
 * a real React hook (`useX`), everything one-shot is a plain method, and
 * both are implemented against the same Tauri commands and stores an
 * external, separately-built plugin would have no way to reach. Proven by
 * building one plugin (`plugins/randomNote.ts`) outside this source tree,
 * against nothing but this file's shape, and loading it at runtime — see
 * `examples/plugins/random-note-external/`. */
export interface PluginContext {
  registerCommand: typeof registerCommand;
  registerSidebarView: typeof sidebarViewRegistry.register;
  registerRightPanelTab: typeof rightPanelTabRegistry.register;
  /** Overrides what a brand-new note is called (see `core.uniqueNoteNames`).
   * Registering a new provider replaces any previous one — call the
   * returned function to hand naming back to the default. */
  registerNoteNameProvider: (provider: () => string) => () => void;

  vault: {
    /** Every known note's path + title. A snapshot, not reactive — for
     * one-shot picks (e.g. "open a random note"), not for rendering a live
     * list. */
    listNotes(): { path: string; title: string }[];
    getOutgoingLinks(path: string): Promise<OutgoingLink[]>;
    /** Reactive: re-fetches whenever `path` or the vault's contents
     * change. */
    useOutgoingLinks(path: string): OutgoingLink[];
    getAllProperties(): Promise<PropertyRow[]>;
    /** Reactive: re-fetches whenever the vault's contents change. */
    useAllProperties(): PropertyRow[];
    getBookmarks(): Promise<string[]>;
    toggleBookmark(path: string): Promise<void>;
    /** Reactive bookmark list for whichever vault is currently open. */
    useBookmarks(): string[];
  };

  workspace: {
    openNote(path: string): Promise<void>;
    getActiveNotePath(): string | null;
    /** Reactive version of `getActiveNotePath`. */
    useActiveNotePath(): string | null;
    /** Reactive live editor-buffer content for `path` — up to the second,
     * unsaved edits included. Empty string if `path` isn't currently open
     * in any pane. */
    useNoteContent(path: string): string;
  };
}

function activeNotePath(): string | null {
  const state = useWorkspaceStore.getState();
  const pane = state.panes.find((p) => p.id === state.activePaneId);
  const path = pane?.activePath ?? null;
  return path && !isEmptyTab(path) ? path : null;
}

function useActiveNotePathHook(): string | null {
  return useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    const path = pane?.activePath ?? null;
    return path && !isEmptyTab(path) ? path : null;
  });
}

function useOutgoingLinksHook(path: string): OutgoingLink[] {
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const [links, setLinks] = useState<OutgoingLink[]>([]);
  useEffect(() => {
    let cancelled = false;
    getOutgoingLinks(path).then((result) => {
      if (!cancelled) setLinks(result);
    });
    return () => {
      cancelled = true;
    };
  }, [path, changeVersion]);
  return links;
}

function useAllPropertiesHook(): PropertyRow[] {
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const [rows, setRows] = useState<PropertyRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    getAllProperties().then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, [changeVersion]);
  return rows;
}

function useNoteContentHook(path: string): string {
  return useWorkspaceStore((s) => s.buffers[path]?.content ?? "");
}

function useBookmarksHook(): string[] {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const ensureLoaded = useBookmarksCacheStore((s) => s.ensureLoaded);
  useEffect(() => {
    ensureLoaded(vaultPath);
  }, [vaultPath, ensureLoaded]);
  return useBookmarksCacheStore((s) => s.paths);
}

export function createPluginContext(): PluginContext {
  return {
    registerCommand,
    registerSidebarView: sidebarViewRegistry.register,
    registerRightPanelTab: rightPanelTabRegistry.register,
    registerNoteNameProvider: (provider) => {
      setNoteNameProvider(provider);
      return () => setNoteNameProvider(null);
    },

    vault: {
      listNotes: () => useVaultStore.getState().noteIndex.notes,
      getOutgoingLinks,
      useOutgoingLinks: useOutgoingLinksHook,
      getAllProperties,
      useAllProperties: useAllPropertiesHook,
      getBookmarks,
      toggleBookmark: (path) => useBookmarksCacheStore.getState().toggle(path),
      useBookmarks: useBookmarksHook,
    },

    workspace: {
      openNote: (path) => useWorkspaceStore.getState().openNote(path),
      getActiveNotePath: activeNotePath,
      useActiveNotePath: useActiveNotePathHook,
      useNoteContent: useNoteContentHook,
    },
  };
}

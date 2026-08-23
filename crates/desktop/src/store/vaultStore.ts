import { create } from "zustand";
import * as api from "../api/vault";
import { buildNoteIndex, type NoteIndex } from "../lib/noteIndex";
import { useSettingsStore } from "./settingsStore";
import type { TreeNode } from "../types/vault";

interface VaultState {
  vaultPath: string | null;
  tree: TreeNode | null;
  noteIndex: NoteIndex;
  isLoading: boolean;
  error: string | null;
  /** Bumped on every `vault:changed` event, so link-derived views (backlinks,
   * unlinked mentions) know when to refetch without polling. */
  changeVersion: number;
  bumpChangeVersion: () => void;
  open: (path: string) => Promise<void>;
  restoreLast: () => Promise<void>;
  refreshTree: () => Promise<void>;
  createFile: (parentPath: string, baseName: string) => Promise<string>;
  createFileWithExtension: (parentPath: string, baseName: string, extension: string) => Promise<string>;
  createFolder: (parentPath: string, baseName: string) => Promise<string>;
  renameEntry: (oldPath: string, newPath: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
}

function findNode(node: TreeNode, path: string): TreeNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function join(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

/** Finds a name like "Untitled.md", "Untitled 1.md", ... not already used among the parent's children. */
function uniqueName(
  tree: TreeNode | null,
  parentPath: string,
  baseName: string,
  extension: string,
): string {
  const parent = tree ? findNode(tree, parentPath) : null;
  const taken = new Set((parent?.children ?? []).map((c) => c.name));
  if (!taken.has(`${baseName}${extension}`)) return `${baseName}${extension}`;
  let i = 1;
  while (taken.has(`${baseName} ${i}${extension}`)) i += 1;
  return `${baseName} ${i}${extension}`;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  tree: null,
  noteIndex: buildNoteIndex(null),
  isLoading: false,
  error: null,
  changeVersion: 0,
  bumpChangeVersion: () => set((s) => ({ changeVersion: s.changeVersion + 1 })),

  open: async (path) => {
    set({ isLoading: true, error: null });
    try {
      const tree = await api.openVault(path, useSettingsStore.getState().settings.history);
      set({ vaultPath: path, tree, noteIndex: buildNoteIndex(tree), isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  restoreLast: async () => {
    set({ isLoading: true, error: null });
    try {
      const restored = await api.restoreLastVault(useSettingsStore.getState().settings.history);
      set({
        tree: restored?.tree ?? null,
        noteIndex: buildNoteIndex(restored?.tree ?? null),
        vaultPath: restored?.path ?? null,
        isLoading: false,
      });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  refreshTree: async () => {
    if (!get().vaultPath) return;
    try {
      const tree = await api.getTree();
      set({ tree, noteIndex: buildNoteIndex(tree) });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  createFile: async (parentPath, baseName) => {
    const name = uniqueName(get().tree, parentPath, baseName, ".md");
    const path = join(parentPath, name);
    await api.createFile(path);
    await get().refreshTree();
    return path;
  },

  createFileWithExtension: async (parentPath, baseName, extension) => {
    const name = uniqueName(get().tree, parentPath, baseName, extension);
    const path = join(parentPath, name);
    await api.createFile(path);
    await get().refreshTree();
    return path;
  },

  createFolder: async (parentPath, baseName) => {
    const name = uniqueName(get().tree, parentPath, baseName, "");
    const path = join(parentPath, name);
    await api.createFolder(path);
    await get().refreshTree();
    return path;
  },

  renameEntry: async (oldPath, newPath) => {
    await api.renameEntry(oldPath, newPath);
    await get().refreshTree();
  },

  deleteEntry: async (path) => {
    await api.deleteEntry(path);
    await get().refreshTree();
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  Backlink,
  FsChange,
  GraphData,
  HeadingEntry,
  Mention,
  ReplaceFilePreview,
  ReplaceSelection,
  SearchFileResult,
  TagCount,
  TreeNode,
} from "../types/vault";

export async function pickVaultFolder(): Promise<string | null> {
  const selection = await openDialog({ directory: true, multiple: false });
  return typeof selection === "string" ? selection : null;
}

export function openVault(path: string): Promise<TreeNode> {
  return invoke("open_vault", { path });
}

export function restoreLastVault(): Promise<{
  path: string;
  tree: TreeNode;
} | null> {
  return invoke("restore_last_vault");
}

export function getTree(): Promise<TreeNode> {
  return invoke("get_tree");
}

export function readNote(path: string): Promise<string> {
  return invoke("read_note", { path });
}

export function writeNote(path: string, content: string): Promise<void> {
  return invoke("write_note", { path, content });
}

export function createFile(path: string): Promise<void> {
  return invoke("create_file", { path });
}

export function createFolder(path: string): Promise<void> {
  return invoke("create_folder", { path });
}

export function previewRename(oldPath: string): Promise<string[]> {
  return invoke("preview_rename", { oldPath });
}

export function renameEntry(oldPath: string, newPath: string): Promise<void> {
  return invoke("rename_entry", { oldPath, newPath });
}

export function deleteEntry(path: string): Promise<void> {
  return invoke("delete_entry", { path });
}

export function getBacklinks(path: string): Promise<Backlink[]> {
  return invoke("get_backlinks", { path });
}

export function getGraphData(): Promise<GraphData> {
  return invoke("get_graph");
}

export function getNoteHeadings(path: string): Promise<HeadingEntry[]> {
  return invoke("get_note_headings", { path });
}

export function getUnlinkedMentions(path: string): Promise<Mention[]> {
  return invoke("get_unlinked_mentions", { path });
}

export function linkMention(
  path: string,
  start: number,
  end: number,
  expectedText: string,
): Promise<void> {
  return invoke("link_mention", { path, start, end, expectedText });
}

export function searchVault(query: string): Promise<SearchFileResult[]> {
  return invoke("search_vault", { query });
}

export function getTagCounts(): Promise<TagCount[]> {
  return invoke("get_tag_counts");
}

export function previewTagRename(tag: string): Promise<string[]> {
  return invoke("preview_tag_rename", { tag });
}

export function renameTag(oldTag: string, newTag: string): Promise<void> {
  return invoke("rename_tag", { oldTag, newTag });
}

export function previewReplace(
  find: string,
  replaceWith: string,
  skipCodeBlocks: boolean,
): Promise<ReplaceFilePreview[]> {
  return invoke("preview_replace", { find, replaceWith, skipCodeBlocks });
}

export function applyReplace(
  find: string,
  replaceWith: string,
  selected: ReplaceSelection[],
): Promise<string[]> {
  return invoke("apply_replace", { find, replaceWith, selected });
}

export function undoLastReplace(): Promise<number> {
  return invoke("undo_last_replace");
}

export function onVaultChanged(
  handler: (change: FsChange) => void,
): Promise<UnlistenFn> {
  return listen<FsChange>("vault:changed", (event) => handler(event.payload));
}

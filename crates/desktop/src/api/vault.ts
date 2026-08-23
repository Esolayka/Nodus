import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  Backlink,
  FileChange,
  FsChange,
  GitCredentials,
  GraphData,
  HeadingEntry,
  LinkCode,
  Mention,
  MergeOutcome,
  MergeSegment,
  OutgoingLink,
  PairCompleteResponse,
  PairStartResponse,
  PropertyRow,
  ReplaceFilePreview,
  DisplayLine,
  HistorySettings,
  ObsidianInspection,
  ReplaceSelection,
  SearchFileResult,
  StorageUsage,
  SyncReport,
  TagCount,
  TaskRow,
  TelegramStatus,
  TreeNode,
  VersionInfo,
} from "../types/vault";

export async function pickVaultFolder(): Promise<string | null> {
  const selection = await openDialog({ directory: true, multiple: false });
  return typeof selection === "string" ? selection : null;
}

export function openVault(path: string, historySettings: HistorySettings): Promise<TreeNode> {
  return invoke("open_vault", { path, historySettings });
}

export function restoreLastVault(historySettings: HistorySettings): Promise<{
  path: string;
  tree: TreeNode;
} | null> {
  return invoke("restore_last_vault", { historySettings });
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

export function getOutgoingLinks(path: string): Promise<OutgoingLink[]> {
  return invoke("get_outgoing_links", { path });
}

export function getAllProperties(): Promise<PropertyRow[]> {
  return invoke("get_all_properties");
}

export function getBookmarks(): Promise<string[]> {
  return invoke("get_bookmarks");
}

export function setBookmarks(paths: string[]): Promise<void> {
  return invoke("set_bookmarks", { paths });
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

export function getAllTasks(): Promise<TaskRow[]> {
  return invoke("get_all_tasks");
}

export function toggleTask(
  path: string,
  markerStart: number,
  markerEnd: number,
  expectedMarker: string,
  addCompletionDate: boolean,
): Promise<void> {
  return invoke("toggle_task", {
    path,
    markerStart,
    markerEnd,
    expectedMarker,
    addCompletionDate,
  });
}

export function setHistorySettings(settings: HistorySettings): Promise<void> {
  return invoke("set_history_settings", { settings });
}

export function getNoteVersions(path: string): Promise<VersionInfo[]> {
  return invoke("get_note_versions", { path });
}

export function getVersionContent(path: string, id: number): Promise<string | null> {
  return invoke("get_version_content", { path, id });
}

export function compareVersionToCurrent(path: string, id: number): Promise<DisplayLine[] | null> {
  return invoke("compare_version_to_current", { path, id });
}

export function restoreVersion(path: string, id: number): Promise<void> {
  return invoke("restore_version", { path, id });
}

export function importAttachmentFromPath(
  folder: string,
  desiredName: string,
  sourceAbsolute: string,
): Promise<string> {
  return invoke("import_attachment_from_path", { folder, desiredName, sourceAbsolute });
}

export function importAttachmentBytes(
  folder: string,
  desiredName: string,
  bytes: Uint8Array,
): Promise<string> {
  return invoke("import_attachment_bytes", { folder, desiredName, bytes: Array.from(bytes) });
}

export function findUnusedAttachments(): Promise<string[]> {
  return invoke("find_unused_attachments");
}

export function inspectObsidianVault(path: string): Promise<ObsidianInspection> {
  return invoke("inspect_obsidian_vault", { path });
}

export function gitEnable(vaultPath: string): Promise<void> {
  return invoke("git_enable", { vaultPath });
}

export function gitStatus(): Promise<FileChange[]> {
  return invoke("git_status");
}

export function gitCommit(message: string, authorName: string, authorEmail: string): Promise<string | null> {
  return invoke("git_commit", { message, authorName, authorEmail });
}

export function gitAddRemote(name: string, url: string): Promise<void> {
  return invoke("git_add_remote", { name, url });
}

export function gitFetch(remote: string, branch: string, credentials: GitCredentials): Promise<void> {
  return invoke("git_fetch", { remote, branch, credentials });
}

export function gitPush(remote: string, branch: string, credentials: GitCredentials): Promise<void> {
  return invoke("git_push", { remote, branch, credentials });
}

export function gitMergeAfterFetch(branch: string): Promise<MergeOutcome> {
  return invoke("git_merge_after_fetch", { branch });
}

export function gitConflictSegments(path: string): Promise<MergeSegment[]> {
  return invoke("git_conflict_segments", { path });
}

export function gitFinalizeResolvedMerge(branch: string, resolutions: Record<string, string>): Promise<void> {
  return invoke("git_finalize_resolved_merge", { branch, resolutions });
}

export function serverSyncEnable(
  vaultPath: string,
  baseUrl: string,
  token: string,
  deviceName: string,
): Promise<void> {
  return invoke("server_sync_enable", { vaultPath, baseUrl, token, deviceName });
}

export function serverSyncOnce(): Promise<SyncReport> {
  return invoke("server_sync_once");
}

export function serverSyncPairStart(): Promise<PairStartResponse> {
  return invoke("server_sync_pair_start");
}

export function serverSyncPairComplete(
  baseUrl: string,
  code: string,
  deviceName: string,
): Promise<PairCompleteResponse> {
  return invoke("server_sync_pair_complete", { baseUrl, code, deviceName });
}

export function serverSyncStorageUsage(): Promise<StorageUsage> {
  return invoke("server_sync_storage_usage");
}

export function telegramSetBotToken(token: string): Promise<void> {
  return invoke("telegram_set_bot_token", { token });
}

export function telegramBotConfigured(): Promise<boolean> {
  return invoke("telegram_bot_configured");
}

export function telegramGenerateLinkCode(): Promise<LinkCode> {
  return invoke("telegram_generate_link_code");
}

export function telegramSetManualAddress(address: string): Promise<void> {
  return invoke("telegram_set_manual_address", { address });
}

export function telegramStartTunnel(): Promise<void> {
  return invoke("telegram_start_tunnel");
}

export function telegramStatus(): Promise<TelegramStatus> {
  return invoke("telegram_status");
}

export function onVaultChanged(
  handler: (change: FsChange) => void,
): Promise<UnlistenFn> {
  return listen<FsChange>("vault:changed", (event) => handler(event.payload));
}

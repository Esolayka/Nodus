export interface TreeNode {
  path: string;
  name: string;
  isDir: boolean;
  children: TreeNode[];
}

export type ChangeKind = "created" | "modified" | "removed";

export interface FsChange {
  kind: ChangeKind;
  path: string;
}

export interface Backlink {
  fromPath: string;
  kind: "wikilink" | "embed";
  context: string;
  line: number;
}

export interface Mention {
  fromPath: string;
  context: string;
  start: number;
  end: number;
}

export interface HeadingEntry {
  level: number;
  text: string;
  position: number;
}

export interface GraphNode {
  path: string;
  title: string;
}

export interface GraphLink {
  fromPath: string;
  toPath: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface SearchLineMatch {
  line: number;
  text: string;
  ranges: [number, number][];
}

export interface SearchFileResult {
  path: string;
  matches: SearchLineMatch[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ReplaceLineMatch {
  line: number;
  before: string;
  after: string;
}

export interface ReplaceFilePreview {
  path: string;
  matches: ReplaceLineMatch[];
}

export interface ReplaceSelection {
  path: string;
  line: number;
}

export interface VersionInfo {
  id: number;
  timestamp: number;
  added: number;
  removed: number;
}

export type DisplayLineKind = "equal" | "added" | "removed";

export interface DisplayLine {
  kind: DisplayLineKind;
  text: string;
}

export interface HistorySettings {
  enabled: boolean;
  maxVersionsPerNote: number;
  maxAgeDays: number;
  maxTotalSizeMb: number;
}

export interface TaskRow {
  path: string;
  line: number;
  done: boolean;
  text: string;
  due: string | null;
  priority: number | null;
  completed: string | null;
  repeat: string | null;
  markerStart: number;
  markerEnd: number;
}

export interface OutgoingLink {
  targetText: string;
  toPath: string | null;
  kind: "wikilink" | "embed";
  line: number;
}

export interface PropertyRow {
  path: string;
  key: string;
  value: string;
}

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  path: string;
  kind: FileChangeKind;
}

export type GitCredentials =
  | { kind: "none" }
  | { kind: "userPassToken"; username: string; token: string }
  | { kind: "sshKey"; privateKeyPath: string; passphrase: string | null };

export type MergeOutcome =
  | { kind: "upToDate" }
  | { kind: "fastForwarded" }
  | { kind: "merged" }
  | { kind: "conflicts"; paths: string[] };

export type MergeSegment =
  | { kind: "clean"; text: string }
  | { kind: "conflict"; mine: string; theirs: string };

export type ConflictChoice = "mine" | "theirs" | "both";

export interface SyncReport {
  uploaded: string[];
  downloaded: string[];
  deletedLocally: string[];
  deletedRemotely: string[];
  conflicts: string[];
}

export interface PairStartResponse {
  code: string;
  expiresAt: number;
}

export interface PairCompleteResponse {
  token: string;
  deviceId: string;
}

export interface StorageUsage {
  usedBytes: number;
  maxBytes: number | null;
  maxFileSizeBytes: number | null;
}

export interface LinkCode {
  token: string;
  expiresAt: number;
}

export interface TelegramStatus {
  localPort: number | null;
  publicAddress: string | null;
  botConfigured: boolean;
}

export interface ObsidianSettings {
  attachmentFolder: string | null;
  templateFolder: string | null;
  dailyNoteFolder: string | null;
  dailyNoteFormat: string | null;
  usesWikilinks: boolean | null;
}

export interface IncompatibleBlock {
  path: string;
  line: number;
  plugin: string;
  rawContent: string;
}

export interface ObsidianInspection {
  isObsidianVault: boolean;
  settings: ObsidianSettings;
  incompatibilities: IncompatibleBlock[];
}

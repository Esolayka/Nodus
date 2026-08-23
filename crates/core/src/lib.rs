pub mod attachments;
pub mod bookmarks;
pub mod error;
pub mod frontmatter;
pub mod fs_ops;
pub mod git_sync;
pub mod heading;
pub mod history;
pub mod import;
pub mod index;
pub mod local_server;
pub mod properties;
pub mod replace;
pub mod search;
pub mod server_sync;
pub mod service;
pub mod tags;
pub mod tasks;
pub mod telegram_link;
pub mod tree;
pub mod vault;
pub mod watcher;
pub mod wikilink;

pub use error::{Error, Result};
pub use git_sync::{
    conflict::{ConflictChoice, MergeSegment},
    FileChange, FileChangeKind, GitCredentials, GitError, GitSync, MergeOutcome,
};
pub use heading::Heading;
pub use history::{DisplayLine, DisplayLineKind, HistorySettings, VersionInfo};
pub use index::{
    Backlink, GraphData, GraphLink, GraphNode, GraphNodeKind, HeadingEntry, Mention, OutgoingLink,
    PropertyRow, TagCount, TaskRow,
};
pub use replace::{ReplaceFilePreview, ReplaceLineMatch, ReplaceSelection};
pub use search::{SearchFileResult, SearchLineMatch};
pub use server_sync::{ChangedFile, PutOutcome, ServerSync, ServerSyncClient, ServerSyncError, SyncReport};
pub use service::VaultService;
pub use tasks::Priority;
pub use telegram_link::{LinkResult, PendingLink, TelegramLinkError};
pub use tree::TreeNode;
pub use vault::Vault;
pub use watcher::{ChangeKind, FsChange};
pub use wikilink::{LinkKind, WikiLink};

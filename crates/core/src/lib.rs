pub mod error;
pub mod frontmatter;
pub mod fs_ops;
pub mod heading;
pub mod index;
pub mod service;
pub mod tree;
pub mod vault;
pub mod watcher;
pub mod wikilink;

pub use error::{Error, Result};
pub use heading::Heading;
pub use index::{Backlink, GraphData, GraphLink, GraphNode, HeadingEntry, Mention};
pub use service::VaultService;
pub use tree::TreeNode;
pub use vault::Vault;
pub use watcher::{ChangeKind, FsChange};
pub use wikilink::{LinkKind, WikiLink};

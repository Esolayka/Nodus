use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use nodus_core::{GitSync, ServerSync, VaultService};

#[derive(Default)]
pub struct AppState {
    pub service: Arc<Mutex<Option<VaultService>>>,
    /// The vault root currently granted to the asset protocol (for
    /// `convertFileSrc`) — tracked so switching vaults can revoke the
    /// previous one instead of leaving it reachable forever.
    pub scoped_vault_root: Mutex<Option<PathBuf>>,
    pub git: Mutex<Option<GitSync>>,
    pub server_sync: Mutex<Option<ServerSync>>,
}

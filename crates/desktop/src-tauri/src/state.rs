use std::sync::Mutex;

use nodus_core::VaultService;

#[derive(Default)]
pub struct AppState {
    pub service: Mutex<Option<VaultService>>,
}

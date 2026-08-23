use std::path::Path;

use nodus_core::import::obsidian::{self, IncompatibleBlock, ObsidianSettings};
use serde::Serialize;

/// Everything the "Open Folder" flow needs to know about a candidate
/// folder before it's opened as a vault: whether it's an Obsidian vault,
/// whatever `.obsidian/` settings could carry over, and a full list of
/// constructs that won't render because they depend on an Obsidian
/// plugin Nodus doesn't run — so the user learns about them immediately,
/// on the very first open, not a week later.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianInspection {
    pub is_obsidian_vault: bool,
    pub settings: ObsidianSettings,
    pub incompatibilities: Vec<IncompatibleBlock>,
}

#[tauri::command]
pub fn inspect_obsidian_vault(path: String) -> ObsidianInspection {
    let root = Path::new(&path);
    if !obsidian::is_obsidian_vault(root) {
        return ObsidianInspection {
            is_obsidian_vault: false,
            settings: ObsidianSettings::default(),
            incompatibilities: Vec::new(),
        };
    }
    ObsidianInspection {
        is_obsidian_vault: true,
        settings: obsidian::read_settings(root),
        incompatibilities: obsidian::scan_incompatible_constructs(root),
    }
}

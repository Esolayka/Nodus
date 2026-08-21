//! Tiny app-level config file (outside any vault): currently just remembers
//! which vault to reopen on next launch. Per-vault settings belong in
//! `.nodus/` inside the vault itself, not here.

use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    last_vault_path: Option<String>,
}

fn config_file_path(app: &AppHandle) -> io::Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| io::Error::other(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

pub fn load_last_vault_path(app: &AppHandle) -> io::Result<Option<String>> {
    let path = config_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)?;
    let config: AppConfig = serde_json::from_str(&text).unwrap_or_default();
    Ok(config.last_vault_path)
}

pub fn save_last_vault_path(app: &AppHandle, path: &str) -> io::Result<()> {
    let config = AppConfig {
        last_vault_path: Some(path.to_string()),
    };
    let text = serde_json::to_string_pretty(&config)?;
    std::fs::write(config_file_path(app)?, text)
}

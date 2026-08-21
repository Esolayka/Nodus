use nodus_core::{
    Backlink, FsChange, GraphData, HeadingEntry, Mention, ReplaceFilePreview, ReplaceSelection,
    SearchFileResult, TagCount, TreeNode, VaultService,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::config;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredVault {
    path: String,
    tree: TreeNode,
}

fn open_service(app: &AppHandle, path: &str) -> Result<VaultService, String> {
    let app_for_events = app.clone();
    VaultService::open(path, move |change: FsChange| {
        let _ = app_for_events.emit("vault:changed", change);
    })
    .map_err(|e| e.to_string())
}

fn with_service<T>(
    state: &State<AppState>,
    f: impl FnOnce(&VaultService) -> nodus_core::Result<T>,
) -> Result<T, String> {
    let guard = state.service.lock().expect("app state mutex poisoned");
    let service = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;
    f(service).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_vault(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<TreeNode, String> {
    let service = open_service(&app, &path)?;
    let tree = service.tree().map_err(|e| e.to_string())?;
    *state.service.lock().expect("app state mutex poisoned") = Some(service);
    config::save_last_vault_path(&app, &path).map_err(|e| e.to_string())?;
    Ok(tree)
}

/// Called once on startup. Reopens the previously used vault, if any.
#[tauri::command]
pub fn restore_last_vault(
    app: AppHandle,
    state: State<AppState>,
) -> Result<Option<RestoredVault>, String> {
    let Some(path) = config::load_last_vault_path(&app).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    if !std::path::Path::new(&path).is_dir() {
        return Ok(None);
    }
    let service = open_service(&app, &path)?;
    let tree = service.tree().map_err(|e| e.to_string())?;
    *state.service.lock().expect("app state mutex poisoned") = Some(service);
    Ok(Some(RestoredVault { path, tree }))
}

#[tauri::command]
pub fn get_tree(state: State<AppState>) -> Result<TreeNode, String> {
    with_service(&state, |s| s.tree())
}

#[tauri::command]
pub fn read_note(state: State<AppState>, path: String) -> Result<String, String> {
    with_service(&state, |s| s.read_note(&path))
}

#[tauri::command]
pub fn write_note(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    with_service(&state, |s| s.write_note(&path, &content))
}

#[tauri::command]
pub fn create_file(state: State<AppState>, path: String) -> Result<(), String> {
    with_service(&state, |s| s.create_file(&path))
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, path: String) -> Result<(), String> {
    with_service(&state, |s| s.create_folder(&path))
}

#[tauri::command]
pub fn preview_rename(state: State<AppState>, old_path: String) -> Result<Vec<String>, String> {
    with_service(&state, |s| s.preview_rename(&old_path))
}

#[tauri::command]
pub fn rename_entry(
    app: AppHandle,
    state: State<AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let relinked = with_service(&state, |s| s.rename_entry(&old_path, &new_path))?;
    for path in relinked {
        let _ = app.emit(
            "vault:changed",
            FsChange {
                kind: nodus_core::ChangeKind::Modified,
                path,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, path: String) -> Result<(), String> {
    with_service(&state, |s| s.delete_entry(&path))
}

#[tauri::command]
pub fn get_backlinks(state: State<AppState>, path: String) -> Result<Vec<Backlink>, String> {
    with_service(&state, |s| s.backlinks(&path))
}

#[tauri::command]
pub fn get_unlinked_mentions(state: State<AppState>, path: String) -> Result<Vec<Mention>, String> {
    with_service(&state, |s| s.unlinked_mentions(&path))
}

#[tauri::command]
pub fn get_graph(state: State<AppState>) -> Result<GraphData, String> {
    with_service(&state, |s| s.graph())
}

#[tauri::command]
pub fn get_note_headings(
    state: State<AppState>,
    path: String,
) -> Result<Vec<HeadingEntry>, String> {
    with_service(&state, |s| s.headings(&path))
}

#[tauri::command]
pub fn resolve_link_target(
    state: State<AppState>,
    target: String,
    from_path: String,
) -> Result<Option<String>, String> {
    let guard = state.service.lock().expect("app state mutex poisoned");
    let service = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;
    Ok(service.resolve_link_target(&target, &from_path))
}

#[tauri::command]
pub fn link_mention(
    state: State<AppState>,
    path: String,
    start: usize,
    end: usize,
    expected_text: String,
) -> Result<(), String> {
    with_service(&state, |s| {
        s.link_mention(&path, start, end, &expected_text)
    })
}

#[tauri::command]
pub fn search_vault(state: State<AppState>, query: String) -> Result<Vec<SearchFileResult>, String> {
    with_service(&state, |s| s.search(&query))
}

#[tauri::command]
pub fn get_tag_counts(state: State<AppState>) -> Result<Vec<TagCount>, String> {
    with_service(&state, |s| s.tag_counts())
}

#[tauri::command]
pub fn preview_tag_rename(state: State<AppState>, tag: String) -> Result<Vec<String>, String> {
    with_service(&state, |s| s.preview_tag_rename(&tag))
}

#[tauri::command]
pub fn rename_tag(
    app: AppHandle,
    state: State<AppState>,
    old_tag: String,
    new_tag: String,
) -> Result<(), String> {
    let renamed = with_service(&state, |s| s.rename_tag(&old_tag, &new_tag))?;
    for path in renamed {
        let _ = app.emit(
            "vault:changed",
            FsChange {
                kind: nodus_core::ChangeKind::Modified,
                path,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn preview_replace(
    state: State<AppState>,
    find: String,
    replace_with: String,
    skip_code_blocks: bool,
) -> Result<Vec<ReplaceFilePreview>, String> {
    with_service(&state, |s| s.preview_replace(&find, &replace_with, skip_code_blocks))
}

#[tauri::command]
pub fn apply_replace(
    app: AppHandle,
    state: State<AppState>,
    find: String,
    replace_with: String,
    selected: Vec<ReplaceSelection>,
) -> Result<Vec<String>, String> {
    let changed = with_service(&state, |s| s.apply_replace(&find, &replace_with, &selected))?;
    for path in &changed {
        let _ = app.emit(
            "vault:changed",
            FsChange {
                kind: nodus_core::ChangeKind::Modified,
                path: path.clone(),
            },
        );
    }
    Ok(changed)
}

#[tauri::command]
pub fn undo_last_replace(app: AppHandle, state: State<AppState>) -> Result<usize, String> {
    let restored = with_service(&state, |s| s.undo_last_replace())?;
    let count = restored.len();
    for path in restored {
        let _ = app.emit(
            "vault:changed",
            FsChange {
                kind: nodus_core::ChangeKind::Modified,
                path,
            },
        );
    }
    Ok(count)
}

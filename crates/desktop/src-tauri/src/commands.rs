use nodus_core::{
    Backlink, DisplayLine, FsChange, GraphData, HeadingEntry, HistorySettings, Mention,
    OutgoingLink, PropertyRow, ReplaceFilePreview, ReplaceSelection, SearchFileResult, TagCount,
    TaskRow, TreeNode, VaultService, VersionInfo,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config;
use crate::state::AppState;

/// Grants the asset protocol (used by `convertFileSrc` for images/audio/
/// video/PDF) access to `new_root` and revokes whatever vault was scoped in
/// before it — so switching vaults doesn't leave the previous one's files
/// reachable for the rest of the session, and no vault ever means no scope
/// wider than nothing at all (the `tauri.conf.json` default is empty).
fn regrant_asset_scope(app: &AppHandle, state: &State<AppState>, new_root: &std::path::Path) {
    let scope = app.asset_protocol_scope();
    let mut scoped = state.scoped_vault_root.lock().expect("app state mutex poisoned");
    if let Some(previous) = scoped.take() {
        let _ = scope.forbid_directory(&previous, true);
    }
    let _ = scope.allow_directory(new_root, true);
    *scoped = Some(new_root.to_path_buf());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredVault {
    path: String,
    tree: TreeNode,
}

fn open_service(
    app: &AppHandle,
    path: &str,
    history_settings: HistorySettings,
) -> Result<VaultService, String> {
    let app_for_events = app.clone();
    VaultService::open(path, history_settings, move |change: FsChange| {
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
    history_settings: HistorySettings,
) -> Result<TreeNode, String> {
    let service = open_service(&app, &path, history_settings)?;
    let tree = service.tree().map_err(|e| e.to_string())?;
    regrant_asset_scope(&app, &state, service.root());
    *state.service.lock().expect("app state mutex poisoned") = Some(service);
    config::save_last_vault_path(&app, &path).map_err(|e| e.to_string())?;
    Ok(tree)
}

/// Called once on startup. Reopens the previously used vault, if any.
#[tauri::command]
pub fn restore_last_vault(
    app: AppHandle,
    state: State<AppState>,
    history_settings: HistorySettings,
) -> Result<Option<RestoredVault>, String> {
    let Some(path) = config::load_last_vault_path(&app).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    if !std::path::Path::new(&path).is_dir() {
        return Ok(None);
    }
    let service = open_service(&app, &path, history_settings)?;
    let tree = service.tree().map_err(|e| e.to_string())?;
    regrant_asset_scope(&app, &state, service.root());
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
pub fn get_outgoing_links(state: State<AppState>, path: String) -> Result<Vec<OutgoingLink>, String> {
    with_service(&state, |s| s.outgoing_links(&path))
}

#[tauri::command]
pub fn get_note_versions(state: State<AppState>, path: String) -> Result<Vec<VersionInfo>, String> {
    let guard = state.service.lock().expect("app state mutex poisoned");
    let service = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;
    Ok(service.list_note_versions(&path))
}

#[tauri::command]
pub fn get_version_content(
    state: State<AppState>,
    path: String,
    id: u64,
) -> Result<Option<String>, String> {
    let guard = state.service.lock().expect("app state mutex poisoned");
    let service = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;
    Ok(service.version_content(&path, id))
}

#[tauri::command]
pub fn compare_version_to_current(
    state: State<AppState>,
    path: String,
    id: u64,
) -> Result<Option<Vec<DisplayLine>>, String> {
    with_service(&state, |s| s.compare_version_to_current(&path, id))
}

#[tauri::command]
pub fn restore_version(state: State<AppState>, path: String, id: u64) -> Result<(), String> {
    with_service(&state, |s| s.restore_version(&path, id))
}

#[tauri::command]
pub fn set_history_settings(state: State<AppState>, settings: HistorySettings) -> Result<(), String> {
    let guard = state.service.lock().expect("app state mutex poisoned");
    let service = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;
    service.set_history_settings(settings);
    Ok(())
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
pub fn get_all_properties(state: State<AppState>) -> Result<Vec<PropertyRow>, String> {
    with_service(&state, |s| s.all_properties())
}

#[tauri::command]
pub fn get_bookmarks(state: State<AppState>) -> Result<Vec<String>, String> {
    with_service(&state, |s| Ok(s.bookmarks()))
}

#[tauri::command]
pub fn set_bookmarks(state: State<AppState>, paths: Vec<String>) -> Result<(), String> {
    with_service(&state, |s| s.set_bookmarks(paths))
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
pub fn get_all_tasks(state: State<AppState>) -> Result<Vec<TaskRow>, String> {
    with_service(&state, |s| s.all_tasks())
}

#[tauri::command]
pub fn toggle_task(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    marker_start: usize,
    marker_end: usize,
    expected_marker: String,
    add_completion_date: bool,
) -> Result<(), String> {
    with_service(&state, |s| {
        s.toggle_task(&path, marker_start, marker_end, &expected_marker, add_completion_date)
    })?;
    let _ = app.emit(
        "vault:changed",
        FsChange {
            kind: nodus_core::ChangeKind::Modified,
            path,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn import_attachment_from_path(
    app: AppHandle,
    state: State<AppState>,
    folder: String,
    desired_name: String,
    source_absolute: String,
) -> Result<String, String> {
    let path = with_service(&state, |s| {
        s.import_attachment_from_path(&folder, &desired_name, std::path::Path::new(&source_absolute))
    })?;
    let _ = app.emit(
        "vault:changed",
        FsChange { kind: nodus_core::ChangeKind::Created, path: path.clone() },
    );
    Ok(path)
}

#[tauri::command]
pub fn import_attachment_bytes(
    app: AppHandle,
    state: State<AppState>,
    folder: String,
    desired_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let path = with_service(&state, |s| s.import_attachment_bytes(&folder, &desired_name, &bytes))?;
    let _ = app.emit(
        "vault:changed",
        FsChange { kind: nodus_core::ChangeKind::Created, path: path.clone() },
    );
    Ok(path)
}

#[tauri::command]
pub fn find_unused_attachments(state: State<AppState>) -> Result<Vec<String>, String> {
    with_service(&state, |s| s.find_unused_attachments())
}

/// Reads an arbitrary absolute file as UTF-8 text — used only to load an
/// external plugin bundle the user explicitly picked via a file dialog
/// (see `plugins/externalLoader.ts`). Deliberately not vault-scoped: unlike
/// every other command here, this reads from wherever the user pointed it,
/// the same trust level as picking a folder to open as a vault.
#[tauri::command]
pub fn read_external_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
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

use std::collections::HashMap;
use std::path::Path;

use nodus_core::{FileChange, GitCredentials, MergeOutcome, MergeSegment};
use tauri::State;

use crate::state::AppState;

fn with_git<T>(
    state: &State<AppState>,
    f: impl FnOnce(&nodus_core::GitSync) -> nodus_core::git_sync::Result<T>,
) -> Result<T, String> {
    let guard = state.git.lock().expect("app state mutex poisoned");
    let git = guard.as_ref().ok_or_else(|| "Git sync is not enabled for this vault".to_string())?;
    f(git).map_err(|e| e.to_string())
}

/// Enables Git sync for the currently open vault: opens (or initializes)
/// a repository at its root and makes sure the derived-data folders are
/// gitignored. Safe to call again later in the same session — reopening an
/// existing repo is a no-op, not a reset.
#[tauri::command]
pub fn git_enable(state: State<AppState>, vault_path: String) -> Result<(), String> {
    let git = nodus_core::GitSync::init_or_open(Path::new(&vault_path)).map_err(|e| e.to_string())?;
    git.ensure_gitignore().map_err(|e| e.to_string())?;
    *state.git.lock().expect("app state mutex poisoned") = Some(git);
    Ok(())
}

#[tauri::command]
pub fn git_status(state: State<AppState>) -> Result<Vec<FileChange>, String> {
    with_git(&state, |g| g.status())
}

#[tauri::command]
pub fn git_commit(
    state: State<AppState>,
    message: String,
    author_name: String,
    author_email: String,
) -> Result<Option<String>, String> {
    with_git(&state, |g| g.commit_all(&message, &author_name, &author_email))
        .map(|oid| oid.map(|o| o.to_string()))
}

#[tauri::command]
pub fn git_add_remote(state: State<AppState>, name: String, url: String) -> Result<(), String> {
    with_git(&state, |g| g.add_remote(&name, &url))
}

#[tauri::command]
pub fn git_fetch(
    state: State<AppState>,
    remote: String,
    branch: String,
    credentials: GitCredentials,
) -> Result<(), String> {
    with_git(&state, |g| g.fetch(&remote, &branch, &credentials))
}

#[tauri::command]
pub fn git_push(
    state: State<AppState>,
    remote: String,
    branch: String,
    credentials: GitCredentials,
) -> Result<(), String> {
    with_git(&state, |g| g.push(&remote, &branch, &credentials))
}

#[tauri::command]
pub fn git_merge_after_fetch(state: State<AppState>, branch: String) -> Result<MergeOutcome, String> {
    with_git(&state, |g| g.merge_after_fetch(&branch))
}

#[tauri::command]
pub fn git_conflict_segments(state: State<AppState>, path: String) -> Result<Vec<MergeSegment>, String> {
    with_git(&state, |g| g.conflict_segments(&path))
}

#[tauri::command]
pub fn git_finalize_resolved_merge(
    state: State<AppState>,
    branch: String,
    resolutions: HashMap<String, String>,
) -> Result<(), String> {
    with_git(&state, |g| g.finalize_resolved_merge(&branch, &resolutions))
}

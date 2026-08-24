mod commands;
mod commands_git;
mod commands_import;
mod commands_server_sync;
mod commands_telegram;
mod config;
mod state;
mod telegram;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state::AppState::default())
        .setup(|app| {
            let app_state = app.state::<state::AppState>();
            let telegram_state = telegram::TelegramState::new(app_state.service.clone());
            let miniapp_dist = telegram::miniapp_dist_dir(app.handle());
            match telegram::start_local_server(telegram_state.server.clone(), miniapp_dist) {
                Ok(port) => {
                    *telegram_state.local_port.lock().expect("mutex poisoned") = Some(port);
                }
                Err(e) => eprintln!("[telegram] failed to start the local-mode HTTP server: {e}"),
            }
            app.manage(telegram_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::ensure_sandbox_vault,
            commands::restore_last_vault,
            commands::get_tree,
            commands::read_note,
            commands::write_note,
            commands::create_file,
            commands::create_folder,
            commands::preview_rename,
            commands::rename_entry,
            commands::delete_entry,
            commands::get_backlinks,
            commands::get_outgoing_links,
            commands::get_note_versions,
            commands::get_version_content,
            commands::compare_version_to_current,
            commands::restore_version,
            commands::set_history_settings,
            commands::get_unlinked_mentions,
            commands::get_graph,
            commands::get_note_headings,
            commands::resolve_link_target,
            commands::link_mention,
            commands::search_vault,
            commands::get_tag_counts,
            commands::get_all_properties,
            commands::get_bookmarks,
            commands::set_bookmarks,
            commands::preview_tag_rename,
            commands::rename_tag,
            commands::preview_replace,
            commands::apply_replace,
            commands::get_all_tasks,
            commands::toggle_task,
            commands::import_attachment_from_path,
            commands::import_attachment_bytes,
            commands::find_unused_attachments,
            commands::read_external_file_text,
            commands::undo_last_replace,
            commands_import::inspect_obsidian_vault,
            commands_git::git_enable,
            commands_git::git_status,
            commands_git::git_commit,
            commands_git::git_add_remote,
            commands_git::git_fetch,
            commands_git::git_push,
            commands_git::git_merge_after_fetch,
            commands_git::git_conflict_segments,
            commands_git::git_finalize_resolved_merge,
            commands_server_sync::server_sync_enable,
            commands_server_sync::server_sync_once,
            commands_server_sync::server_sync_pair_start,
            commands_server_sync::server_sync_pair_complete,
            commands_server_sync::server_sync_storage_usage,
            commands_telegram::telegram_set_bot_token,
            commands_telegram::telegram_bot_configured,
            commands_telegram::telegram_generate_link_code,
            commands_telegram::telegram_set_manual_address,
            commands_telegram::telegram_start_tunnel,
            commands_telegram::telegram_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

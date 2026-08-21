mod commands;
mod config;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
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
            commands::get_unlinked_mentions,
            commands::get_graph,
            commands::get_note_headings,
            commands::resolve_link_target,
            commands::link_mention,
            commands::search_vault,
            commands::get_tag_counts,
            commands::preview_tag_rename,
            commands::rename_tag,
            commands::preview_replace,
            commands::apply_replace,
            commands::undo_last_replace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

//! Obsidian compatibility. Opening an Obsidian vault needs no conversion
//! at all — the files are already valid Markdown Nodus reads natively —
//! so this module's only two jobs are reading what settings can carry
//! over from `.obsidian/`, and scanning for constructs that depend on
//! Obsidian plugins Nodus doesn't have, so the user learns about them on
//! the first open, not a week later. Nothing here ever writes to the
//! vault — `.obsidian/` is never touched, and Nodus's own data lives
//! entirely under `.nodus/`, so both programs can keep working on the
//! same folder side by side.

use std::path::Path;

use serde::Serialize;

use super::encoding;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianSettings {
    pub attachment_folder: Option<String>,
    pub template_folder: Option<String>,
    pub daily_note_folder: Option<String>,
    pub daily_note_format: Option<String>,
    /// `true` if this vault is set to Obsidian's wikilink format (the
    /// default), `false` if it's set to plain Markdown links, `None` if
    /// `app.json` didn't say (also the default when absent).
    pub uses_wikilinks: Option<bool>,
}

pub fn is_obsidian_vault(root: &Path) -> bool {
    root.join(".obsidian").is_dir()
}

fn read_json(path: &Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

/// Reads whatever `.obsidian/app.json` and its neighbors have — every
/// field is optional, since a vault may simply not have customized it
/// (Obsidian only writes a setting to disk once the user changes it from
/// the built-in default).
pub fn read_settings(root: &Path) -> ObsidianSettings {
    let obsidian_dir = root.join(".obsidian");
    let app_json = read_json(&obsidian_dir.join("app.json"));
    let daily_notes_json = read_json(&obsidian_dir.join("daily-notes.json"));
    let templates_json = read_json(&obsidian_dir.join("templates.json"));

    let str_field =
        |v: &serde_json::Value, key: &str| v.get(key).and_then(|v| v.as_str()).map(str::to_string);

    ObsidianSettings {
        attachment_folder: str_field(&app_json, "attachmentFolderPath"),
        template_folder: str_field(&templates_json, "folder"),
        daily_note_folder: str_field(&daily_notes_json, "folder"),
        daily_note_format: str_field(&daily_notes_json, "format"),
        uses_wikilinks: app_json
            .get("useMarkdownLinks")
            .and_then(|v| v.as_bool())
            .map(|use_markdown| !use_markdown),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncompatibleBlock {
    pub path: String,
    pub line: usize,
    pub plugin: String,
    pub raw_content: String,
}

/// Walks every note looking for constructs that depend on an Obsidian
/// plugin Nodus doesn't run: Dataview/Dataview-JS query blocks, a Tasks
/// plugin *query* block specifically (not an ordinary checklist item —
/// those already render), and Templater's `<% %>` template tags. Never
/// attempts to support them; just finds and reports every occurrence.
pub fn scan_incompatible_constructs(root: &Path) -> Vec<IncompatibleBlock> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue; // .obsidian, .nodus, .git, ...
            }
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if !name.to_lowercase().ends_with(".md") {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            let content = encoding::decode_text(&bytes);
            let Ok(relative) = path.strip_prefix(root) else {
                continue;
            };
            let relative_str = relative.to_string_lossy().replace('\\', "/");
            found.extend(scan_note(&relative_str, &content));
        }
    }
    found
}

fn scan_note(relative_path: &str, content: &str) -> Vec<IncompatibleBlock> {
    let mut blocks = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim_start();
        if let Some(lang) = trimmed.strip_prefix("```").map(str::trim) {
            let plugin = match lang.to_lowercase().as_str() {
                "dataview" | "dataviewjs" => Some("Dataview"),
                "tasks" => Some("Tasks"),
                _ => None,
            };
            if let Some(plugin) = plugin {
                let start = i;
                let mut end = i + 1;
                while end < lines.len() && !lines[end].trim_start().starts_with("```") {
                    end += 1;
                }
                let last = end.min(lines.len().saturating_sub(1));
                blocks.push(IncompatibleBlock {
                    path: relative_path.to_string(),
                    line: start + 1,
                    plugin: plugin.to_string(),
                    raw_content: lines[start..=last].join("\n"),
                });
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }

    for (idx, line) in lines.iter().enumerate() {
        if line.contains("<%") {
            blocks.push(IncompatibleBlock {
                path: relative_path.to_string(),
                line: idx + 1,
                plugin: "Templater".to_string(),
                raw_content: line.to_string(),
            });
        }
    }

    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_a_vault_by_the_obsidian_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_obsidian_vault(dir.path()));
        std::fs::create_dir(dir.path().join(".obsidian")).unwrap();
        assert!(is_obsidian_vault(dir.path()));
    }

    #[test]
    fn reads_settings_present_in_app_json_and_neighbors() {
        let dir = tempfile::tempdir().unwrap();
        let obsidian = dir.path().join(".obsidian");
        std::fs::create_dir(&obsidian).unwrap();
        std::fs::write(
            obsidian.join("app.json"),
            r#"{"attachmentFolderPath": "attachments", "useMarkdownLinks": false}"#,
        )
        .unwrap();
        std::fs::write(
            obsidian.join("daily-notes.json"),
            r#"{"folder": "Daily", "format": "YYYY-MM-DD"}"#,
        )
        .unwrap();
        std::fs::write(
            obsidian.join("templates.json"),
            r#"{"folder": "Templates"}"#,
        )
        .unwrap();

        let settings = read_settings(dir.path());
        assert_eq!(settings.attachment_folder.as_deref(), Some("attachments"));
        assert_eq!(settings.daily_note_folder.as_deref(), Some("Daily"));
        assert_eq!(settings.daily_note_format.as_deref(), Some("YYYY-MM-DD"));
        assert_eq!(settings.template_folder.as_deref(), Some("Templates"));
        assert_eq!(settings.uses_wikilinks, Some(true));
    }

    #[test]
    fn missing_settings_files_yield_all_none_rather_than_erroring() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".obsidian")).unwrap();
        let settings = read_settings(dir.path());
        assert!(settings.attachment_folder.is_none());
        assert!(settings.uses_wikilinks.is_none());
    }

    #[test]
    fn finds_a_dataview_query_block() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Note.md"),
            "Some text.\n\n```dataview\nLIST FROM #project\n```\n",
        )
        .unwrap();
        let found = scan_incompatible_constructs(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].plugin, "Dataview");
        assert!(found[0].raw_content.contains("LIST FROM"));
    }

    #[test]
    fn finds_a_tasks_query_block_but_not_an_ordinary_checklist() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Note.md"),
            "- [ ] ordinary task 📅 2026-01-01\n\n```tasks\nnot done\ndue before tomorrow\n```\n",
        )
        .unwrap();
        let found = scan_incompatible_constructs(dir.path());
        assert_eq!(
            found.len(),
            1,
            "an ordinary checklist item must not be flagged"
        );
        assert_eq!(found[0].plugin, "Tasks");
    }

    #[test]
    fn finds_templater_tags_anywhere_in_the_note() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Template.md"),
            "Today is <% tp.date.now() %>.\n",
        )
        .unwrap();
        let found = scan_incompatible_constructs(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].plugin, "Templater");
    }

    #[test]
    fn a_plain_vanilla_note_has_nothing_to_report() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Note.md"),
            "# Just a note\n\nWith a [[link]] and a #tag.\n",
        )
        .unwrap();
        assert!(scan_incompatible_constructs(dir.path()).is_empty());
    }

    #[test]
    fn does_not_descend_into_dotfolders_like_dot_obsidian_or_dot_nodus() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".obsidian")).unwrap();
        std::fs::write(
            dir.path().join(".obsidian/workspace.json"),
            "```dataview\nLIST\n```",
        )
        .unwrap();
        assert!(scan_incompatible_constructs(dir.path()).is_empty());
    }
}

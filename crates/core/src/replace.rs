//! Vault-wide find/replace — plain literal text (not the search query DSL;
//! a replace needs an exact string to substitute, not a boolean query),
//! computed per line so each occurrence can be previewed and selectively
//! applied before anything touches disk.

use serde::{Deserialize, Serialize};

use crate::wikilink::{code_ranges, in_ranges};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceLineMatch {
    /// 1-indexed line number.
    pub line: usize,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFilePreview {
    pub path: String,
    pub matches: Vec<ReplaceLineMatch>,
}

/// One specific line-match the user checked in the preview, identifying
/// exactly what to actually rewrite when applying.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceSelection {
    pub path: String,
    pub line: usize,
}

/// Case-insensitive literal replacement of every occurrence of `find` with
/// `replace` in `line`, preserving the original text's casing everywhere
/// else.
fn replace_line(line: &str, find_lower: &str, replace: &str) -> String {
    let line_lower = line.to_lowercase();
    let mut result = String::new();
    let mut last = 0;
    let mut cursor = 0;
    while let Some(pos) = line_lower[cursor..].find(find_lower) {
        let abs = cursor + pos;
        result.push_str(&line[last..abs]);
        result.push_str(replace);
        last = abs + find_lower.len();
        cursor = last;
    }
    result.push_str(&line[last..]);
    result
}

/// Per-line preview of what replacing `find` with `replace` would do to
/// `content` — only lines that would actually change are included. When
/// `skip_code_blocks` is set, lines inside fenced/inline code are left out
/// entirely (their `find` occurrences, if any, are literal syntax, not
/// prose to rewrite).
pub fn preview_replace(
    content: &str,
    find: &str,
    replace: &str,
    skip_code_blocks: bool,
) -> Vec<ReplaceLineMatch> {
    if find.is_empty() {
        return Vec::new();
    }
    let find_lower = find.to_lowercase();
    let code = if skip_code_blocks {
        code_ranges(content)
    } else {
        Vec::new()
    };

    let mut results = Vec::new();
    let mut pos = 0usize;
    for (i, line) in content.split('\n').enumerate() {
        let line_start = pos;
        pos += line.len() + 1;
        if skip_code_blocks && in_ranges(&code, line_start) {
            continue;
        }
        if !line.to_lowercase().contains(&find_lower) {
            continue;
        }
        let after = replace_line(line, &find_lower, replace);
        if after != line {
            results.push(ReplaceLineMatch {
                line: i + 1,
                before: line.to_string(),
                after,
            });
        }
    }
    results
}

/// Applies the replacement to just the given 1-indexed `selected_lines`
/// (already known, from a preview pass, to actually change) — everything
/// else in `content` passes through untouched.
pub fn apply_selected_lines(
    content: &str,
    find: &str,
    replace: &str,
    selected_lines: &std::collections::HashSet<usize>,
) -> String {
    if find.is_empty() || selected_lines.is_empty() {
        return content.to_string();
    }
    let find_lower = find.to_lowercase();
    let lines: Vec<String> = content
        .split('\n')
        .enumerate()
        .map(|(i, line)| {
            if selected_lines.contains(&(i + 1)) {
                replace_line(line, &find_lower, replace)
            } else {
                line.to_string()
            }
        })
        .collect();
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_only_changed_lines() {
        let content = "foo here\nnothing\nfoo again";
        let matches = preview_replace(content, "foo", "bar", false);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].after, "bar here");
        assert_eq!(matches[1].line, 3);
        assert_eq!(matches[1].after, "bar again");
    }

    #[test]
    fn is_case_insensitive_but_preserves_surrounding_case() {
        let content = "FOO and foo and Foo";
        let matches = preview_replace(content, "foo", "bar", false);
        assert_eq!(matches[0].after, "bar and bar and bar");
    }

    #[test]
    fn skips_code_blocks_when_flag_set() {
        let content = "foo outside\n```\nfoo inside code\n```\nfoo outside again";
        let matches = preview_replace(content, "foo", "bar", true);
        let lines: Vec<usize> = matches.iter().map(|m| m.line).collect();
        assert_eq!(lines, vec![1, 5]);
    }

    #[test]
    fn does_not_skip_code_blocks_when_flag_unset() {
        let content = "foo outside\n```\nfoo inside code\n```\n";
        let matches = preview_replace(content, "foo", "bar", false);
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn apply_selected_lines_only_touches_chosen_lines() {
        let content = "foo one\nfoo two\nfoo three";
        let selected: std::collections::HashSet<usize> = [1, 3].into_iter().collect();
        let result = apply_selected_lines(content, "foo", "bar", &selected);
        assert_eq!(result, "bar one\nfoo two\nbar three");
    }

    #[test]
    fn apply_preserves_trailing_newline() {
        let content = "foo one\nfoo two\n";
        let selected: std::collections::HashSet<usize> = [1, 2].into_iter().collect();
        let result = apply_selected_lines(content, "foo", "bar", &selected);
        assert_eq!(result, "bar one\nbar two\n");
    }
}

//! Extracting `#tags` from note text — both inline (`#project/nodus` in the
//! body) and from the `tags:` frontmatter field. Both sources feed one
//! index, so a note tagged either way shows up the same in the tags panel.

use crate::frontmatter;
use crate::wikilink::{code_ranges, in_ranges};

#[derive(Debug, Clone, PartialEq)]
pub struct TagOccurrence {
    /// Normalized tag text, no leading `#`, no leading/trailing `/`.
    pub tag: String,
    /// Byte range of the tag's own text (not the `#`) in the whole file —
    /// precise enough to splice in a replacement for rename.
    pub start: usize,
    pub end: usize,
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// `#foo`, `#project/nodus` — rejects anything with no letters at all (so
/// `#1` or a stray `#` isn't picked up as a tag), and trims stray leading or
/// trailing `/` from sloppy input.
fn normalize_tag(raw: &str) -> Option<String> {
    let trimmed = raw.trim_start_matches('#').trim_matches('/');
    if trimmed.is_empty() || trimmed.contains("//") {
        return None;
    }
    if !trimmed.chars().any(|c| c.is_alphabetic()) {
        return None;
    }
    if !trimmed.chars().all(|c| is_tag_char(c) || c == '/') {
        return None;
    }
    Some(trimmed.to_string())
}

/// Inline `#tag` occurrences in the body — skips fenced/inline code (a tag
/// written as example syntax isn't a real tag) and the frontmatter block
/// itself (a `#` there is YAML comment syntax, not a tag).
fn find_inline_tags(content: &str) -> Vec<TagOccurrence> {
    let body_start = match frontmatter::raw_block(content) {
        Some((yaml, yaml_start)) => yaml_start + yaml.len(),
        None => 0,
    };
    let code = code_ranges(content);
    let bytes = content.as_bytes();
    let chars: Vec<(usize, char)> = content.char_indices().collect();
    let mut tags = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let (byte_pos, ch) = chars[i];
        if ch == '#' && byte_pos >= body_start && !in_ranges(&code, byte_pos) {
            let prev_is_word = i > 0 && {
                let (prev_pos, _) = chars[i - 1];
                is_tag_char(bytes[prev_pos] as char) || bytes[prev_pos] == b'#'
            };
            if !prev_is_word {
                let mut j = i + 1;
                while j < chars.len() {
                    let (_, c2) = chars[j];
                    if is_tag_char(c2) || c2 == '/' {
                        j += 1;
                    } else {
                        break;
                    }
                }
                let name_start = byte_pos + 1;
                let name_end = chars.get(j).map(|(p, _)| *p).unwrap_or(content.len());
                let raw_name = &content[name_start..name_end];
                if let Some(tag) = normalize_tag(raw_name) {
                    let lead_hash = raw_name.len() - raw_name.trim_start_matches('#').len();
                    let start = name_start + lead_hash;
                    tags.push(TagOccurrence {
                        end: start + tag.len(),
                        tag,
                        start,
                    });
                }
                i = j.max(i + 1);
                continue;
            }
        }
        i += 1;
    }
    tags
}

/// Given a raw (untrimmed) YAML scalar and the absolute byte offset of its
/// first byte in the whole file, returns the normalized tag plus its own
/// byte range (quotes and surrounding whitespace excluded) — or `None` if it
/// doesn't look like a tag.
fn locate_tag(raw: &str, raw_offset: usize) -> Option<TagOccurrence> {
    let lead_ws = raw.len() - raw.trim_start().len();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (unquoted, quote_len) = if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        (&trimmed[1..trimmed.len() - 1], 1)
    } else {
        (trimmed, 0)
    };
    let tag = normalize_tag(unquoted)?;
    let start = raw_offset + lead_ws + quote_len;
    Some(TagOccurrence {
        end: start + tag.len(),
        tag,
        start,
    })
}

/// `tags:` in frontmatter — a block sequence (`tags:\n  - a\n  - b`), a flow
/// sequence (`tags: [a, b]`), or a bare scalar/comma list (`tags: a, b`).
fn find_frontmatter_tags(content: &str) -> Vec<TagOccurrence> {
    let Some((yaml, yaml_start)) = frontmatter::raw_block(content) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    let lines: Vec<&str> = yaml.split_inclusive('\n').collect();
    let mut offset = 0usize;
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let bare = line.trim_end_matches(['\n', '\r']);
        let trimmed = bare.trim_start();
        let indent = bare.len() - trimmed.len();

        let Some(rest) = trimmed.strip_prefix("tags:") else {
            offset += line.len();
            i += 1;
            continue;
        };
        let rest_offset = offset + (bare.len() - rest.len());

        if rest.trim().is_empty() {
            // Block sequence: subsequent, more-indented `- item` lines.
            let mut j = i + 1;
            let mut item_offset = offset + line.len();
            while j < lines.len() {
                let next_line = lines[j];
                let next_bare = next_line.trim_end_matches(['\n', '\r']);
                let next_trimmed = next_bare.trim_start();
                let next_indent = next_bare.len() - next_trimmed.len();
                if next_indent <= indent || !next_trimmed.starts_with('-') {
                    break;
                }
                let dash_offset = next_bare.len() - next_trimmed.len();
                let value_raw = &next_trimmed[1..];
                let value_abs_offset = yaml_start + item_offset + dash_offset + 1;
                if let Some(occ) = locate_tag(value_raw, value_abs_offset) {
                    result.push(occ);
                }
                item_offset += next_line.len();
                j += 1;
            }
            offset = item_offset;
            i = j;
            continue;
        }

        let value = rest.trim_start();
        let value_offset = rest_offset + (rest.len() - value.len());
        let (inner, inner_shift) = match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            Some(inner) => (inner, 1),
            None => (value, 0),
        };
        let mut seg_offset = 0usize;
        for segment in inner.split(',') {
            let abs_offset = yaml_start + value_offset + inner_shift + seg_offset;
            if let Some(occ) = locate_tag(segment, abs_offset) {
                result.push(occ);
            }
            seg_offset += segment.len() + 1;
        }

        offset += line.len();
        i += 1;
    }

    result
}

/// All tag occurrences in a note — inline and frontmatter, combined.
pub fn find_tags(content: &str) -> Vec<TagOccurrence> {
    let mut tags = find_inline_tags(content);
    tags.extend(find_frontmatter_tags(content));
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_plain_inline_tag() {
        let tags = find_tags("Some text #project here.");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "project");
        assert_eq!(
            &"Some text #project here."[tags[0].start..tags[0].end],
            "project"
        );
    }

    #[test]
    fn finds_nested_inline_tag() {
        let tags = find_tags("Working on #project/nodus today.");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "project/nodus");
    }

    #[test]
    fn ignores_heading_hash() {
        let tags = find_tags("# Heading\n\nBody text.");
        assert!(tags.is_empty());
    }

    #[test]
    fn ignores_hash_mid_word() {
        let tags = find_tags("issue#123 is not a tag");
        assert!(tags.is_empty());
    }

    #[test]
    fn ignores_purely_numeric_tag() {
        let tags = find_tags("See #123 for details.");
        assert!(tags.is_empty());
    }

    #[test]
    fn ignores_tag_inside_fenced_code() {
        let content = "Real #tag here.\n\n```\n#not-a-tag\n```\n";
        let tags = find_tags(content);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "tag");
    }

    #[test]
    fn ignores_tag_inside_inline_code() {
        let tags = find_tags("Use `#notatag` syntax, or #real.");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "real");
    }

    #[test]
    fn finds_frontmatter_block_sequence_tags() {
        let content = "---\ntitle: Hello\ntags:\n  - alpha\n  - beta/gamma\n---\nBody.\n";
        let tags = find_tags(content);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].tag, "alpha");
        assert_eq!(&content[tags[0].start..tags[0].end], "alpha");
        assert_eq!(tags[1].tag, "beta/gamma");
        assert_eq!(&content[tags[1].start..tags[1].end], "beta/gamma");
    }

    #[test]
    fn finds_frontmatter_flow_sequence_tags() {
        let content = "---\ntags: [one, two]\n---\nBody.\n";
        let tags = find_tags(content);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].tag, "one");
        assert_eq!(&content[tags[0].start..tags[0].end], "one");
        assert_eq!(tags[1].tag, "two");
        assert_eq!(&content[tags[1].start..tags[1].end], "two");
    }

    #[test]
    fn finds_frontmatter_scalar_tag() {
        let content = "---\ntags: solo\n---\nBody.\n";
        let tags = find_tags(content);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "solo");
        assert_eq!(&content[tags[0].start..tags[0].end], "solo");
    }

    #[test]
    fn frontmatter_hash_comment_is_not_a_tag() {
        let content = "---\n# just a YAML comment\ntitle: Hello\n---\n#real tag in body.\n";
        let tags = find_tags(content);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].tag, "real");
    }

    #[test]
    fn combines_inline_and_frontmatter_sources() {
        let content = "---\ntags:\n  - fromfm\n---\nBody with #inline tag.\n";
        let tags = find_tags(content);
        let names: Vec<&str> = tags.iter().map(|t| t.tag.as_str()).collect();
        assert!(names.contains(&"fromfm"));
        assert!(names.contains(&"inline"));
    }
}

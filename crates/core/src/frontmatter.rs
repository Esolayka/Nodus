//! Parsing and serializing the YAML frontmatter block at the top of a note.
//!
//! Fields the app doesn't know about must survive a read-modify-write cycle
//! unchanged, so the block is kept as a generic [`serde_yaml::Mapping`]
//! (order-preserving) rather than a fixed struct — nothing here ever drops a
//! key it doesn't recognize.

use crate::error::Result;

const FENCE: &str = "---";

#[derive(Debug, Clone, PartialEq)]
pub struct Frontmatter(pub serde_yaml::Mapping);

impl Frontmatter {
    pub fn get(&self, key: &str) -> Option<&serde_yaml::Value> {
        self.0.get(key)
    }

    pub fn set(&mut self, key: &str, value: serde_yaml::Value) {
        self.0
            .insert(serde_yaml::Value::String(key.to_string()), value);
    }
}

/// Splits a note's raw text into its frontmatter (if any) and body.
///
/// The frontmatter block must start on the file's first line with `---` and
/// end with a line that is exactly `---`. Anything else is treated as a note
/// with no frontmatter.
pub fn parse(content: &str) -> Result<(Option<Frontmatter>, &str)> {
    let Some(after_open) = content.strip_prefix(FENCE) else {
        return Ok((None, content));
    };
    // The opening fence must be alone on its line.
    let Some(after_open) = after_open
        .strip_prefix('\n')
        .or_else(|| after_open.strip_prefix("\r\n"))
    else {
        return Ok((None, content));
    };

    let Some(close_pos) = find_closing_fence(after_open) else {
        return Ok((None, content));
    };
    let (yaml, rest) = after_open.split_at(close_pos);
    let body = strip_closing_fence_line(rest);

    let value: serde_yaml::Value = serde_yaml::from_str(yaml)?;
    let mapping = match value {
        serde_yaml::Value::Mapping(m) => m,
        serde_yaml::Value::Null => serde_yaml::Mapping::new(),
        other => {
            let mut m = serde_yaml::Mapping::new();
            m.insert(serde_yaml::Value::String("value".to_string()), other);
            m
        }
    };
    Ok((Some(Frontmatter(mapping)), body))
}

fn find_closing_fence(text: &str) -> Option<usize> {
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == FENCE {
            return Some(offset);
        }
        offset += line.len();
    }
    None
}

fn strip_closing_fence_line(rest: &str) -> &str {
    let after_fence = &rest[FENCE.len()..];
    after_fence
        .strip_prefix('\n')
        .or_else(|| after_fence.strip_prefix("\r\n"))
        .unwrap_or(after_fence)
}

/// Reassembles a note from frontmatter (if any) and body.
pub fn serialize(frontmatter: Option<&Frontmatter>, body: &str) -> Result<String> {
    match frontmatter {
        None => Ok(body.to_string()),
        Some(fm) => {
            let yaml = serde_yaml::to_string(&fm.0)?;
            Ok(format!("{FENCE}\n{yaml}{FENCE}\n{body}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_without_frontmatter_is_passed_through() {
        let (fm, body) = parse("# Just a note\n\nNo frontmatter here.").unwrap();
        assert!(fm.is_none());
        assert_eq!(body, "# Just a note\n\nNo frontmatter here.");
    }

    #[test]
    fn parses_frontmatter_and_body() {
        let content = "---\ntitle: Hello\ntags:\n  - a\n  - b\n---\nBody text.\n";
        let (fm, body) = parse(content).unwrap();
        let fm = fm.unwrap();
        assert_eq!(
            fm.get("title"),
            Some(&serde_yaml::Value::String("Hello".to_string()))
        );
        assert_eq!(body, "Body text.\n");
    }

    #[test]
    fn round_trip_preserves_unknown_fields() {
        let content = "---\ntitle: Hello\nunknown_plugin_field: keep-me\n---\nBody.\n";
        let (fm, body) = parse(content).unwrap();
        let mut fm = fm.unwrap();
        fm.set("title", serde_yaml::Value::String("Updated".to_string()));

        let rebuilt = serialize(Some(&fm), body).unwrap();
        assert!(rebuilt.contains("unknown_plugin_field: keep-me"));
        assert!(rebuilt.contains("title: Updated"));

        // And parsing it again still has both fields.
        let (fm2, _) = parse(&rebuilt).unwrap();
        let fm2 = fm2.unwrap();
        assert_eq!(
            fm2.get("unknown_plugin_field"),
            Some(&serde_yaml::Value::String("keep-me".to_string()))
        );
    }

    #[test]
    fn body_without_closing_fence_is_not_frontmatter() {
        let content = "---\ntitle: Hello\nno closing fence";
        let (fm, body) = parse(content).unwrap();
        assert!(fm.is_none());
        assert_eq!(body, content);
    }
}

//! Extracting a note's frontmatter as flat (key, value) pairs, for the
//! vault-wide properties index. This is read-only browsing (open the note,
//! don't jump to a byte), so unlike `tags::find_frontmatter_tags` there's no
//! need for byte-accurate positions — the real YAML parser in `frontmatter`
//! is used directly instead of a hand-rolled line scan.

use crate::frontmatter;

pub fn find_properties(content: &str) -> Vec<(String, String)> {
    let Ok((Some(fm), _)) = frontmatter::parse(content) else {
        return Vec::new();
    };
    fm.0.iter()
        .filter_map(|(k, v)| match k {
            serde_yaml::Value::String(key) => Some((key.clone(), stringify_value(v))),
            _ => None,
        })
        .collect()
}

fn stringify_value(value: &serde_yaml::Value) -> String {
    match value {
        serde_yaml::Value::String(s) => s.clone(),
        serde_yaml::Value::Number(n) => n.to_string(),
        serde_yaml::Value::Bool(b) => b.to_string(),
        serde_yaml::Value::Null => String::new(),
        serde_yaml::Value::Sequence(seq) => {
            seq.iter().map(stringify_value).collect::<Vec<_>>().join(", ")
        }
        other => serde_yaml::to_string(other).unwrap_or_default().trim().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_scalar_and_list_properties() {
        let content = "---\ntitle: Hello\ntags:\n  - a\n  - b\nstatus: draft\n---\nBody.\n";
        assert_eq!(
            find_properties(content),
            vec![
                ("title".to_string(), "Hello".to_string()),
                ("tags".to_string(), "a, b".to_string()),
                ("status".to_string(), "draft".to_string()),
            ]
        );
    }

    #[test]
    fn no_frontmatter_returns_empty() {
        assert_eq!(find_properties("# Just a note\n\nBody."), Vec::new());
    }

    #[test]
    fn malformed_frontmatter_returns_empty_rather_than_erroring() {
        assert_eq!(find_properties("---\n[unterminated\n---\nBody.\n"), Vec::new());
    }
}

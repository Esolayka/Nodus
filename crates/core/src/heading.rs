//! Parsing ATX headings (`# Heading` .. `###### Heading`) out of raw note
//! text — used to populate the `headings` index table, which backs
//! `[[Note#Heading]]` anchor resolution and heading-autocomplete for notes
//! other than the one currently open.

use crate::wikilink::{code_ranges, in_ranges};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    /// Byte offset of the line the heading starts on.
    pub position: usize,
}

/// Scans `content` for ATX headings, skipping any that fall inside a fenced
/// code block (a `# ` inside ` ```...``` ` is literal text, not a heading).
pub fn find_headings(content: &str) -> Vec<Heading> {
    let code = code_ranges(content);
    let mut headings = Vec::new();
    let mut pos = 0;

    for line in content.split_inclusive('\n') {
        let bare = line.trim_end_matches('\n');
        if !in_ranges(&code, pos) {
            if let Some((level, text)) = parse_atx_heading(bare) {
                headings.push(Heading {
                    level,
                    text,
                    position: pos,
                });
            }
        }
        pos += line.len();
    }

    headings
}

fn parse_atx_heading(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None; // 4+ leading spaces makes it an indented code block, not a heading.
    }
    let hashes = trimmed.bytes().take_while(|&b| b == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &trimmed[hashes..];
    if !rest.is_empty() && !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None; // e.g. `#tag`, not a heading.
    }
    let text = rest.trim().trim_end_matches('#').trim().to_string();
    Some((hashes as u8, text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_headings_of_every_level() {
        let content = "# One\n## Two\n###### Six";
        let headings = find_headings(content);
        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[0].text, "One");
        assert_eq!(headings[2].level, 6);
        assert_eq!(headings[2].text, "Six");
    }

    #[test]
    fn strips_trailing_hashes() {
        let headings = find_headings("## Title ##");
        assert_eq!(headings[0].text, "Title");
    }

    #[test]
    fn ignores_hash_without_space_and_code_blocks() {
        let content = "#nottag\n```\n# Not A Heading\n```\n# Real";
        let headings = find_headings(content);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].text, "Real");
    }

    #[test]
    fn records_byte_position() {
        let content = "intro\n\n## Section";
        let headings = find_headings(content);
        assert_eq!(headings[0].position, 7);
        assert_eq!(&content[7..], "## Section");
    }
}

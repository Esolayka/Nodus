//! Parsing `[[wikilinks]]` and `![[embeds]]` out of raw note text.
//!
//! Deliberately hand-rolled instead of pulling in a regex/grammar dependency:
//! the syntax is small (`[[target]]`, `[[target#heading]]`,
//! `[[target|alias]]`, `[[target#heading|alias]]`, optionally prefixed with
//! `!` for an embed) and doesn't nest, so a linear scan is both simpler and
//! easier to reason about than a grammar.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Wikilink,
    Embed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikiLink {
    /// Byte range in the source text, including `[[`/`![[` and the closing `]]`.
    pub start: usize,
    pub end: usize,
    pub kind: LinkKind,
    /// Raw target as typed, e.g. `"Projects/Ideas"` in `[[Projects/Ideas#Top|Ideas]]`.
    pub target: String,
    pub heading: Option<String>,
    pub alias: Option<String>,
    /// Byte range of just the target text, for in-place rewrites on rename.
    pub target_range: (usize, usize),
}

/// Scans `content` for every `[[...]]` / `![[...]]` occurrence.
pub fn find_wikilinks(content: &str) -> Vec<WikiLink> {
    let bytes = content.as_bytes();
    let mut links = Vec::new();
    let mut i = 0;

    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let is_embed = i > 0 && bytes[i - 1] == b'!';
            let inner_start = i + 2;
            if let Some(close) = find_closing(content, inner_start) {
                let inner = &content[inner_start..close];
                if !inner.is_empty() && !inner.contains('\n') {
                    let (target, heading, alias, target_range) = split_inner(inner, inner_start);
                    if !target.trim().is_empty() {
                        links.push(WikiLink {
                            start: if is_embed { i - 1 } else { i },
                            end: close + 2,
                            kind: if is_embed {
                                LinkKind::Embed
                            } else {
                                LinkKind::Wikilink
                            },
                            target: target.trim().to_string(),
                            heading,
                            alias,
                            target_range,
                        });
                    }
                }
                i = close + 2;
                continue;
            }
        }
        i += 1;
    }

    links
}

fn find_closing(content: &str, from: usize) -> Option<usize> {
    content[from..].find("]]").map(|pos| from + pos)
}

/// Splits `target#heading|alias` (heading/alias optional) and returns the
/// byte range of just the target portion, relative to the whole document.
fn split_inner(
    inner: &str,
    inner_start: usize,
) -> (String, Option<String>, Option<String>, (usize, usize)) {
    let (before_alias, alias) = match inner.find('|') {
        Some(pos) => (&inner[..pos], Some(inner[pos + 1..].trim().to_string())),
        None => (inner, None),
    };
    let (target, heading) = match before_alias.find('#') {
        Some(pos) => (
            &before_alias[..pos],
            Some(before_alias[pos + 1..].trim().to_string()),
        ),
        None => (before_alias, None),
    };
    let target_range = (inner_start, inner_start + target.len());
    (target.to_string(), heading, alias, target_range)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_plain_wikilink() {
        let links = find_wikilinks("See [[Other Note]] for details.");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "Other Note");
        assert_eq!(links[0].kind, LinkKind::Wikilink);
        assert_eq!(links[0].heading, None);
        assert_eq!(links[0].alias, None);
    }

    #[test]
    fn finds_heading_and_alias() {
        let links = find_wikilinks("[[Note#Section|shown text]]");
        assert_eq!(links[0].target, "Note");
        assert_eq!(links[0].heading.as_deref(), Some("Section"));
        assert_eq!(links[0].alias.as_deref(), Some("shown text"));
    }

    #[test]
    fn finds_embed() {
        let links = find_wikilinks("Here: ![[image.png]]");
        assert_eq!(links[0].kind, LinkKind::Embed);
        assert_eq!(links[0].target, "image.png");
        // start includes the `!`.
        assert_eq!(
            &"Here: ![[image.png]]"[links[0].start..links[0].end],
            "![[image.png]]"
        );
    }

    #[test]
    fn finds_multiple_links_on_one_line() {
        let links = find_wikilinks("[[A]] and [[B]]");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "A");
        assert_eq!(links[1].target, "B");
    }

    #[test]
    fn ignores_unclosed_and_empty_brackets() {
        assert!(find_wikilinks("[[unclosed").is_empty());
        assert!(find_wikilinks("[[]]").is_empty());
        assert!(find_wikilinks("not a [[link\nacross]] a newline").is_empty());
    }

    #[test]
    fn target_range_points_at_target_only() {
        let content = "[[Old Name|alias]]";
        let links = find_wikilinks(content);
        let (from, to) = links[0].target_range;
        assert_eq!(&content[from..to], "Old Name");
    }
}

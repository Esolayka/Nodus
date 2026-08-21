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

/// Scans `content` for every `[[...]]` / `![[...]]` occurrence, skipping any
/// found inside fenced code blocks or inline code spans — code is meant to
/// show the literal syntax, not participate in the link graph.
pub fn find_wikilinks(content: &str) -> Vec<WikiLink> {
    let code = code_ranges(content);
    let bytes = content.as_bytes();
    let mut links = Vec::new();
    let mut i = 0;

    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' && !in_ranges(&code, i) {
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

pub(crate) fn in_ranges(ranges: &[(usize, usize)], pos: usize) -> bool {
    ranges
        .iter()
        .any(|&(from, to)| pos >= from && pos < to)
}

/// Byte ranges of code: fenced blocks (``` or ~~~, 3+ markers, optionally
/// indented up to 3 spaces) span from the opening fence line through the
/// closing fence line (or end of document, if unterminated); inline code
/// spans (`` `...` ``) pair a backtick run with the next run of the same
/// length on the same line, outside any fence.
pub(crate) fn code_ranges(content: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut fence: Option<(u8, usize, usize)> = None; // (fence char, run length, block start)
    let mut pos = 0;

    for line in content.split_inclusive('\n') {
        let bare = line.trim_end_matches('\n');
        let leading_spaces = bare.len() - bare.trim_start().len();
        let trimmed = bare.trim_start();

        let run_char = trimmed.as_bytes().first().copied().filter(|&b| b == b'`' || b == b'~');
        let run_len = run_char
            .map(|ch| trimmed.bytes().take_while(|&b| b == ch).count())
            .unwrap_or(0);

        if leading_spaces <= 3 && run_len >= 3 {
            match fence {
                Some((ch, len, start)) if run_char == Some(ch) && run_len >= len => {
                    ranges.push((start, pos + line.len()));
                    fence = None;
                }
                None => {
                    fence = Some((run_char.unwrap(), run_len, pos));
                }
                _ => {}
            }
        } else if fence.is_none() {
            ranges.extend(inline_code_spans(bare, pos));
        }

        pos += line.len();
    }

    if let Some((_, _, start)) = fence {
        ranges.push((start, content.len()));
    }

    ranges
}

/// Inline `` `code` `` spans within a single line, `line_start` being that
/// line's byte offset into the whole document.
fn inline_code_spans(line: &str, line_start: usize) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let run_start = i;
            let run_len = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            i += run_len;
            let search_from = i;
            if let Some(rel) = find_backtick_run(&line[search_from..], run_len) {
                let close_start = search_from + rel;
                spans.push((line_start + run_start, line_start + close_start + run_len));
                i = close_start + run_len;
            }
        } else {
            i += 1;
        }
    }
    spans
}

/// Finds the next run of exactly `len` backticks in `text`, returning its
/// byte offset (not preceded or followed by another backtick, so a longer
/// run doesn't get mistaken for a match).
fn find_backtick_run(text: &str, len: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let run_len = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            if run_len == len {
                return Some(i);
            }
            i += run_len;
        } else {
            i += 1;
        }
    }
    None
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

    #[test]
    fn ignores_link_inside_fenced_code_block() {
        let content = "Real [[Link]] here.\n\n```\n[[Not A Link]]\n```\n\nAnother [[Real Link]].";
        let links = find_wikilinks(content);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "Link");
        assert_eq!(links[1].target, "Real Link");
    }

    #[test]
    fn ignores_link_inside_tilde_fence_with_backtick_target() {
        let content = "~~~\n[[Skip]]\n~~~\n[[Keep]]";
        let links = find_wikilinks(content);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "Keep");
    }

    #[test]
    fn ignores_link_inside_inline_code_span() {
        let content = "Use `[[Not A Link]]` syntax, or [[A Real Link]].";
        let links = find_wikilinks(content);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "A Real Link");
    }

    #[test]
    fn unterminated_fence_treats_rest_of_document_as_code() {
        let content = "[[Before]]\n```\n[[Inside]]\nstill code, no closing fence";
        let links = find_wikilinks(content);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "Before");
    }

    #[test]
    fn finds_link_inside_frontmatter() {
        // Frontmatter is plain YAML text, not code — links there are real
        // links, so rename must be able to find and rewrite them too.
        let content = "---\nrelated: \"[[Other Note]]\"\n---\n\nBody text.";
        let links = find_wikilinks(content);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "Other Note");
    }
}

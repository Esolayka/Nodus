//! The vault-wide search query DSL: plain words (AND), `"exact phrases"`,
//! `-excluded` terms, `path:`/`tag:`/`file:` filters, `line:` (require a
//! group's terms to co-occur on one line), and `OR` between term groups.
//!
//! Deliberately hand-rolled and infallible — malformed input (an unterminated
//! quote, a stray `-`, whatever) never errors, it just falls back to
//! searching as plain text for whatever *did* parse cleanly.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Term {
    Word(String),
    Phrase(String),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct AndGroup {
    pub terms: Vec<Term>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ParsedQuery {
    pub or_groups: Vec<AndGroup>,
    pub excluded: Vec<Term>,
    pub path_filter: Option<String>,
    pub tag_filter: Option<String>,
    pub file_filter: Option<String>,
    pub same_line: bool,
}

fn tokenize(input: &str) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let mut token = String::new();
        if chars[i] == '-' {
            token.push('-');
            i += 1;
        }
        if i < chars.len() && chars[i] == '"' {
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                token.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                i += 1; // closing quote, if any — an unterminated quote just takes the rest
            }
        } else {
            while i < chars.len() && !chars[i].is_whitespace() {
                token.push(chars[i]);
                i += 1;
            }
        }
        if !token.is_empty() && token != "-" {
            tokens.push(token);
        }
    }
    tokens
}

fn make_term(text: &str) -> Term {
    if text.contains(' ') {
        Term::Phrase(text.to_string())
    } else {
        Term::Word(text.to_string())
    }
}

pub(crate) fn parse_query(input: &str) -> ParsedQuery {
    let mut query = ParsedQuery::default();
    let mut current = AndGroup::default();

    for tok in tokenize(input) {
        if tok == "OR" {
            query.or_groups.push(std::mem::take(&mut current));
            continue;
        }
        if let Some(rest) = tok.strip_prefix('-') {
            if !rest.is_empty() {
                query.excluded.push(make_term(rest));
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("path:") {
            if !rest.is_empty() {
                query.path_filter = Some(rest.to_string());
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("tag:") {
            if !rest.is_empty() {
                query.tag_filter = Some(rest.trim_start_matches('#').to_string());
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("file:") {
            if !rest.is_empty() {
                query.file_filter = Some(rest.to_string());
            }
            continue;
        }
        if tok == "line:" {
            query.same_line = true;
            continue;
        }
        current.terms.push(make_term(&tok));
    }
    query.or_groups.push(current);
    query
}

/// `path:`/`file:`/`tag:` filters always match case-insensitively (they're
/// identifiers, not searched text) regardless of `case_sensitive` — that
/// only affects plain word/phrase terms, matching Obsidian's own "match
/// case" toggle.
fn term_needle(term: &Term, case_sensitive: bool) -> String {
    let text = match term {
        Term::Word(w) => w.as_str(),
        Term::Phrase(p) => p.as_str(),
    };
    if case_sensitive { text.to_string() } else { text.to_lowercase() }
}

fn term_matches(term: &Term, haystack: &str, case_sensitive: bool) -> bool {
    let needle = term_needle(term, case_sensitive);
    !needle.is_empty() && haystack.contains(&needle)
}

/// Whether `content` (already known to belong to `path` with `tags`)
/// satisfies the whole parsed query — filters, exclusions, and at least one
/// OR-group's terms (all of them, honoring `same_line`).
pub(crate) fn matches_file(
    query: &ParsedQuery,
    path: &str,
    tags: &[String],
    content: &str,
    case_sensitive: bool,
) -> bool {
    let content_cased = if case_sensitive { content.to_string() } else { content.to_lowercase() };

    for excluded in &query.excluded {
        if term_matches(excluded, &content_cased, case_sensitive) {
            return false;
        }
    }
    if let Some(pf) = &query.path_filter {
        if !path.to_lowercase().contains(&pf.to_lowercase()) {
            return false;
        }
    }
    if let Some(ff) = &query.file_filter {
        let filename = path.rsplit('/').next().unwrap_or(path);
        if !filename.to_lowercase().contains(&ff.to_lowercase()) {
            return false;
        }
    }
    if let Some(tf) = &query.tag_filter {
        let tf_lower = tf.to_lowercase();
        if !tags.iter().any(|t| t.to_lowercase() == tf_lower) {
            return false;
        }
    }

    let has_any_terms = query.or_groups.iter().any(|g| !g.terms.is_empty());
    if !has_any_terms {
        return true; // a pure-filter query, e.g. just `tag:foo`
    }

    query.or_groups.iter().any(|group| {
        if group.terms.is_empty() {
            return false;
        }
        if query.same_line {
            content.lines().any(|line| {
                let line_cased = if case_sensitive { line.to_string() } else { line.to_lowercase() };
                group.terms.iter().all(|t| term_matches(t, &line_cased, case_sensitive))
            })
        } else {
            group.terms.iter().all(|t| term_matches(t, &content_cased, case_sensitive))
        }
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLineMatch {
    /// 1-indexed line number.
    pub line: usize,
    pub text: String,
    /// Char-offset ranges within `text` to highlight.
    pub ranges: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    pub path: String,
    pub matches: Vec<SearchLineMatch>,
}

/// Every positive term across every OR-group, for display highlighting —
/// unlike `matches_file`'s all-must-hold-per-group logic, here we just want
/// to know which lines contain *any* of them.
pub(crate) fn highlight_lines(
    query: &ParsedQuery,
    content: &str,
    case_sensitive: bool,
) -> Vec<SearchLineMatch> {
    let all_terms: Vec<&Term> = query.or_groups.iter().flat_map(|g| g.terms.iter()).collect();
    if all_terms.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    for (i, line) in content.split('\n').enumerate() {
        let line_cased = if case_sensitive { line.to_string() } else { line.to_lowercase() };
        let mut ranges: Vec<(usize, usize)> = Vec::new();
        for term in &all_terms {
            let needle = term_needle(term, case_sensitive);
            if needle.is_empty() {
                continue;
            }
            let mut start = 0;
            while let Some(pos) = line_cased[start..].find(&needle) {
                let abs = start + pos;
                ranges.push((abs, abs + needle.len()));
                start = abs + needle.len();
            }
        }
        if !ranges.is_empty() {
            ranges.sort_by_key(|r| r.0);
            results.push(SearchLineMatch {
                line: i + 1,
                text: line.to_string(),
                ranges,
            });
        }
    }
    results
}

/// A safe, narrow-only FTS5 MATCH expression covering every positive word in
/// the query (each as a prefix match, for minimal morphology support) —
/// `None` if there's nothing safely usable, in which case the caller should
/// fall back to scanning every note directly rather than skip narrowing
/// incorrectly.
pub(crate) fn narrowing_fts_query(query: &ParsedQuery) -> Option<String> {
    let mut safe_terms = Vec::new();
    for group in &query.or_groups {
        for term in &group.terms {
            let words: Vec<&str> = match term {
                Term::Word(w) => vec![w.as_str()],
                Term::Phrase(p) => p.split_whitespace().collect(),
            };
            for w in words {
                let cleaned: String = w.chars().filter(|c| c.is_alphanumeric()).collect();
                if !cleaned.is_empty() {
                    safe_terms.push(format!("{cleaned}*"));
                }
            }
        }
    }
    if safe_terms.is_empty() {
        None
    } else {
        Some(safe_terms.join(" OR "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_words_are_and() {
        let q = parse_query("foo bar");
        assert!(matches_file(&q, "a.md", &[], "has foo and bar in it", false));
        assert!(!matches_file(&q, "a.md", &[], "has only foo in it", false));
    }

    #[test]
    fn quoted_phrase_requires_adjacency() {
        let q = parse_query("\"foo bar\"");
        assert!(matches_file(&q, "a.md", &[], "here is foo bar together", false));
        assert!(!matches_file(&q, "a.md", &[], "here foo comes before bar separately", false));
    }

    #[test]
    fn minus_excludes() {
        let q = parse_query("foo -bar");
        assert!(matches_file(&q, "a.md", &[], "just foo here", false));
        assert!(!matches_file(&q, "a.md", &[], "foo and bar both here", false));
    }

    #[test]
    fn or_keyword_is_alternation() {
        let q = parse_query("foo OR bar");
        assert!(matches_file(&q, "a.md", &[], "only foo", false));
        assert!(matches_file(&q, "a.md", &[], "only bar", false));
        assert!(!matches_file(&q, "a.md", &[], "neither", false));
    }

    #[test]
    fn path_filter_restricts_by_path() {
        let q = parse_query("foo path:Projects");
        assert!(matches_file(&q, "Projects/a.md", &[], "foo", false));
        assert!(!matches_file(&q, "Other/a.md", &[], "foo", false));
    }

    #[test]
    fn file_filter_restricts_by_filename() {
        let q = parse_query("foo file:Diary");
        assert!(matches_file(&q, "Journal/Diary.md", &[], "foo", false));
        assert!(!matches_file(&q, "Journal/Notes.md", &[], "foo", false));
    }

    #[test]
    fn tag_filter_checks_tags_list() {
        let q = parse_query("tag:project");
        assert!(matches_file(&q, "a.md", &["project".to_string()], "anything", false));
        assert!(!matches_file(&q, "a.md", &["other".to_string()], "anything", false));
    }

    #[test]
    fn line_flag_requires_same_line_cooccurrence() {
        let q = parse_query("foo bar line:");
        assert!(matches_file(&q, "a.md", &[], "foo and bar on one line\nsomething else", false));
        assert!(!matches_file(&q, "a.md", &[], "foo on this line\nbar on this other line", false));
    }

    #[test]
    fn malformed_unterminated_quote_does_not_crash() {
        let q = parse_query("foo \"unterminated");
        // Falls back to treating the dangling quoted content as plain text.
        assert!(matches_file(&q, "a.md", &[], "foo unterminated appears here", false));
    }

    #[test]
    fn prefix_morphology_minimum() {
        let q = parse_query("заметк");
        assert!(matches_file(&q, "a.md", &[], "здесь есть заметки", false));
        assert!(matches_file(&q, "a.md", &[], "работаю с заметками", false));
    }

    #[test]
    fn highlight_lines_reports_correct_ranges() {
        let q = parse_query("foo");
        let matches = highlight_lines(&q, "line one\nhas foo in it\nfoo again here", false);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line, 2);
        let (s, e) = matches[0].ranges[0];
        assert_eq!(&matches[0].text[s..e], "foo");
    }

    #[test]
    fn case_sensitive_flag_distinguishes_case() {
        let q = parse_query("Foo");
        assert!(matches_file(&q, "a.md", &[], "a Foo here", true));
        assert!(!matches_file(&q, "a.md", &[], "a foo here", true));
        // Case-insensitive (the default) still matches either.
        assert!(matches_file(&q, "a.md", &[], "a foo here", false));
    }

    #[test]
    fn case_sensitive_does_not_affect_path_or_tag_filters() {
        let q = parse_query("tag:Project path:Notes");
        assert!(matches_file(&q, "notes/a.md", &["PROJECT".to_string()], "x", true));
    }

    #[test]
    fn narrowing_query_is_safe_for_weird_input() {
        // Should never panic regardless of input garbage.
        let q = parse_query("!!! ### ...");
        let _ = narrowing_fts_query(&q);
    }
}

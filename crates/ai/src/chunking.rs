//! Splitting a note into overlapping fragments for embedding — indexing
//! whole files would blur a search for one specific idea buried in a
//! long note into "somewhat relevant to this entire document"; fragments
//! keep a match pointing at the actual paragraph that matched.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextChunk {
    pub text: String,
    /// Byte offsets into the original note content — lets a match jump
    /// straight to the matching passage instead of just the file.
    pub start: usize,
    pub end: usize,
}

/// Splits `text` into chunks of roughly `chunk_chars` characters, each
/// overlapping the previous by `overlap_chars` — so an idea that happens
/// to sit right on a chunk boundary still appears whole in at least one
/// chunk. Breaks are pushed out to the nearest paragraph or sentence
/// boundary where one exists nearby, rather than always cutting exactly
/// at `chunk_chars`, so a chunk doesn't end mid-word for a still-fairly-
/// short note.
pub fn chunk_text(text: &str, chunk_chars: usize, overlap_chars: usize) -> Vec<TextChunk> {
    assert!(chunk_chars > overlap_chars, "a chunk must advance past its own overlap");
    if text.is_empty() {
        return Vec::new();
    }
    if text.chars().count() <= chunk_chars {
        return vec![TextChunk { text: text.to_string(), start: 0, end: text.len() }];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < text.len() {
        let mut end = advance_chars(text, start, chunk_chars);
        if end < text.len() {
            end = nearest_break(text, end);
        }
        if end <= start {
            end = advance_chars(text, start, chunk_chars).max(start + 1).min(text.len());
        }
        chunks.push(TextChunk { text: text[start..end].to_string(), start, end });
        if end >= text.len() {
            break;
        }
        let next_start = end.saturating_sub(overlap_char_bytes(text, end, overlap_chars));
        start = if next_start > start { next_start } else { end };
    }
    chunks
}

/// Byte offset `chars` characters after `from`, clamped to the string's
/// length and always landing on a char boundary.
fn advance_chars(text: &str, from: usize, chars: usize) -> usize {
    text[from..].char_indices().nth(chars).map(|(i, _)| from + i).unwrap_or(text.len())
}

/// How many bytes back from `end` covers `overlap_chars` characters —
/// used to step the next chunk's start back into the previous one.
fn overlap_char_bytes(text: &str, end: usize, overlap_chars: usize) -> usize {
    let prefix = &text[..end];
    let mut count = 0;
    for (i, _) in prefix.char_indices().rev() {
        if count == overlap_chars {
            return end - i;
        }
        count += 1;
    }
    end
}

/// Looks for a paragraph break, then a sentence end, within a small
/// window around `pos`, so chunk boundaries land somewhere natural more
/// often than not; falls back to `pos` itself (already a char boundary)
/// when nothing suitable is nearby.
fn nearest_break(text: &str, pos: usize) -> usize {
    const WINDOW: usize = 80;
    let window_start = pos.saturating_sub(WINDOW);
    let window_end = (pos + WINDOW).min(text.len());
    let mut search_start = window_start;
    while !text.is_char_boundary(search_start) {
        search_start += 1;
    }
    let mut search_end = window_end;
    while !text.is_char_boundary(search_end) {
        search_end -= 1;
    }
    let window = &text[search_start..search_end];

    if let Some(idx) = window.rfind("\n\n") {
        return search_start + idx + 2;
    }
    if let Some(idx) = window.rfind(". ") {
        return search_start + idx + 2;
    }
    if let Some(idx) = window.rfind('\n') {
        return search_start + idx + 1;
    }
    pos
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_a_single_chunk() {
        let chunks = chunk_text("A short note.", 500, 50);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "A short note.");
        assert_eq!(chunks[0].start, 0);
    }

    #[test]
    fn empty_text_produces_no_chunks() {
        assert!(chunk_text("", 500, 50).is_empty());
    }

    #[test]
    fn long_text_is_split_into_multiple_overlapping_chunks() {
        let paragraph = "This is one sentence of reasonable length. ".repeat(40);
        let chunks = chunk_text(&paragraph, 300, 50);
        assert!(chunks.len() > 1);
        for pair in chunks.windows(2) {
            assert!(pair[1].start < pair[0].end, "consecutive chunks should overlap");
        }
    }

    #[test]
    fn chunks_reconstruct_contiguous_coverage_of_the_original_text() {
        let text = "Paragraph one has some words.\n\nParagraph two has some other words.\n\nAnd a third paragraph rounds things out with more content still.".repeat(3);
        let chunks = chunk_text(&text, 100, 20);
        assert!(!chunks.is_empty());
        assert_eq!(chunks.last().unwrap().end, text.len(), "the last chunk should reach the end of the text");
        for chunk in &chunks {
            assert_eq!(&text[chunk.start..chunk.end], chunk.text, "offsets must slice back to the same text");
        }
    }

    #[test]
    fn prefers_breaking_at_a_paragraph_boundary_when_one_is_nearby() {
        let text = format!("{}\n\n{}", "word ".repeat(50), "more words ".repeat(50));
        let chunks = chunk_text(&text, 260, 30);
        // The natural paragraph break should have been used instead of an
        // arbitrary mid-window cut, landing very close to it.
        let break_pos = text.find("\n\n").unwrap() + 2;
        assert!((chunks[0].end as i64 - break_pos as i64).abs() <= 5);
    }

    #[test]
    fn handles_multibyte_text_without_panicking_or_splitting_a_character() {
        let text = "Привет мир. ".repeat(60);
        let chunks = chunk_text(&text, 100, 20);
        for chunk in &chunks {
            assert!(text.is_char_boundary(chunk.start));
            assert!(text.is_char_boundary(chunk.end));
        }
    }
}

//! Keeping a request inside a model's context window. Providers reject
//! (or silently truncate, worse) a request that's too long, so this
//! trims proactively — with the caller told it happened — rather than
//! ever sending a request already known to be doomed.

/// Context-window sizes (in tokens) for well-known model name
/// fragments, matched by substring against the model id in whatever
/// case the user typed or picked it in. This is inherently best-effort —
/// providers rename and add models constantly — so it exists only to
/// avoid an obviously-oversized request; the provider's own response is
/// still the authority (see `classify_error_response`'s
/// `RequestTooLarge` case for when a request gets through this check but
/// is still rejected).
const KNOWN_CONTEXT_WINDOWS: &[(&str, usize)] = &[
    ("claude-", 200_000),
    ("gemini-1.5", 1_000_000),
    ("gemini-2", 1_000_000),
    ("gpt-4o", 128_000),
    ("gpt-4-turbo", 128_000),
    ("gpt-4.1", 1_000_000),
    ("o1", 128_000),
    ("o3", 128_000),
    ("gpt-3.5", 16_385),
    ("gpt-4", 8_192),
    ("mixtral", 32_000),
    ("mistral", 32_000),
    ("llama3", 8_192),
    ("llama-3", 8_192),
];

/// Used when the model isn't recognized at all — small enough that
/// truncation kicking in is a safe default rather than an optimistic
/// guess that turns out to be too generous.
const DEFAULT_CONTEXT_WINDOW: usize = 8_192;

pub fn context_window_for_model(model: &str) -> usize {
    let lower = model.to_lowercase();
    KNOWN_CONTEXT_WINDOWS
        .iter()
        .find(|(fragment, _)| lower.contains(fragment))
        .map(|(_, size)| *size)
        .unwrap_or(DEFAULT_CONTEXT_WINDOW)
}

/// A rough ~4-characters-per-token estimate — the same heuristic model
/// providers themselves document when an exact tokenizer isn't worth
/// running. Good enough to decide whether to truncate; not a token
/// count to bill against.
pub fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() as f64 / 4.0).ceil() as usize
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TruncationResult {
    pub text: String,
    pub truncated: bool,
    pub estimated_tokens: usize,
}

/// Trims `text` from the end until it fits in `max_tokens`, minus
/// `reserve_for_output` tokens left over for the model's reply. Always
/// leaves at least a small floor of budget rather than truncating to
/// nothing.
pub fn truncate_to_budget(
    text: &str,
    max_tokens: usize,
    reserve_for_output: usize,
) -> TruncationResult {
    let budget = max_tokens.saturating_sub(reserve_for_output).max(256);
    let estimated = estimate_tokens(text);
    if estimated <= budget {
        return TruncationResult {
            text: text.to_string(),
            truncated: false,
            estimated_tokens: estimated,
        };
    }

    let max_chars = budget * 4;
    let mut cut = max_chars.min(text.len());
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let truncated_text = text[..cut].to_string();
    let estimated_tokens = estimate_tokens(&truncated_text);
    TruncationResult {
        text: truncated_text,
        truncated: true,
        estimated_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_known_model_families() {
        assert_eq!(context_window_for_model("claude-opus-5"), 200_000);
        assert_eq!(context_window_for_model("gpt-4o-mini"), 128_000);
        assert_eq!(context_window_for_model("llama3:8b"), 8_192);
    }

    #[test]
    fn falls_back_to_a_conservative_default_for_unknown_models() {
        assert_eq!(
            context_window_for_model("some-brand-new-model-nobody-has-heard-of"),
            DEFAULT_CONTEXT_WINDOW
        );
    }

    #[test]
    fn text_within_budget_is_left_untouched() {
        let text = "short note content";
        let result = truncate_to_budget(text, 8_192, 1_000);
        assert!(!result.truncated);
        assert_eq!(result.text, text);
    }

    #[test]
    fn text_over_budget_is_cut_and_flagged() {
        let text = "word ".repeat(10_000);
        let result = truncate_to_budget(&text, 1_000, 200);
        assert!(result.truncated);
        assert!(result.text.len() < text.len());
        assert!(result.estimated_tokens <= 800);
    }

    #[test]
    fn truncation_never_splits_a_multibyte_character() {
        let text = "п".repeat(5_000);
        let result = truncate_to_budget(&text, 100, 20);
        assert!(result.truncated);
        assert!(String::from_utf8(result.text.into_bytes()).is_ok());
    }
}

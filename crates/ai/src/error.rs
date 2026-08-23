//! Errors are classified into a small set of user-facing categories
//! instead of leaking a raw status code or transport error — "invalid
//! key", "quota exceeded", "address unreachable", "request too large"
//! are the four cases the AI-assistant spec calls out by name, and
//! everyone one of them is answerable by the user, unlike "Error 429".

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("this API key was rejected — check that it's correct and still active")]
    InvalidApiKey,
    #[error("the provider says this key's usage quota is used up")]
    QuotaExceeded,
    #[error("couldn't reach {address}: {reason}")]
    Unreachable { address: String, reason: String },
    #[error("this request is too large for {model} — shorten the selection or include less context")]
    RequestTooLarge { model: String },
    #[error("the provider returned something Nodus didn't expect: {0}")]
    UnexpectedResponse(String),
    #[error("system keyring error: {0}")]
    Keyring(#[from] keyring::Error),
}

pub type Result<T> = std::result::Result<T, ProviderError>;

/// A `reqwest` error from actually sending the request (as opposed to a
/// non-2xx response, which `classify_error_response` handles) — a
/// connection failure or timeout is exactly the "address unreachable"
/// case, so it's classified here rather than left as an opaque transport
/// error.
pub fn classify_transport_error(err: reqwest::Error, address: &str) -> ProviderError {
    ProviderError::Unreachable { address: address.to_string(), reason: err.without_url().to_string() }
}

/// Classifies a non-2xx HTTP response body. Real providers don't share
/// one error schema, so this matches on status code first and falls back
/// to keyword-sniffing the body — good enough to route to the right
/// friendly message, not meant to be exhaustive.
pub fn classify_error_response(status: u16, body: &str, model: &str) -> ProviderError {
    let lower = body.to_lowercase();
    if status == 401
        || status == 403
        || lower.contains("invalid api key")
        || lower.contains("invalid_api_key")
        || lower.contains("incorrect api key")
        || lower.contains("authentication_error")
        || lower.contains("invalid x-api-key")
    {
        return ProviderError::InvalidApiKey;
    }
    if status == 429
        || lower.contains("quota")
        || lower.contains("rate_limit")
        || lower.contains("insufficient_quota")
    {
        return ProviderError::QuotaExceeded;
    }
    if lower.contains("context_length_exceeded")
        || lower.contains("maximum context length")
        || lower.contains("too many tokens")
        || lower.contains("prompt is too long")
    {
        return ProviderError::RequestTooLarge { model: model.to_string() };
    }
    ProviderError::UnexpectedResponse(format!("HTTP {status}: {body}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_openai_style_invalid_key() {
        let body = r#"{"error": {"message": "Incorrect API key provided", "type": "invalid_request_error"}}"#;
        assert!(matches!(classify_error_response(401, body, "gpt-4o"), ProviderError::InvalidApiKey));
    }

    #[test]
    fn classifies_anthropic_style_invalid_key() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        assert!(matches!(classify_error_response(401, body, "claude-opus-5"), ProviderError::InvalidApiKey));
    }

    #[test]
    fn classifies_quota_exceeded() {
        let body = r#"{"error": {"message": "You exceeded your current quota", "code": "insufficient_quota"}}"#;
        assert!(matches!(classify_error_response(429, body, "gpt-4o"), ProviderError::QuotaExceeded));
    }

    #[test]
    fn classifies_context_length_exceeded() {
        let body = r#"{"error": {"message": "This model's maximum context length is 8192 tokens", "code": "context_length_exceeded"}}"#;
        match classify_error_response(400, body, "gpt-4") {
            ProviderError::RequestTooLarge { model } => assert_eq!(model, "gpt-4"),
            other => panic!("expected RequestTooLarge, got {other:?}"),
        }
    }

    #[test]
    fn falls_back_to_unexpected_response_for_unrecognized_errors() {
        let result = classify_error_response(500, "internal server error", "gpt-4o");
        assert!(matches!(result, ProviderError::UnexpectedResponse(_)));
    }
}

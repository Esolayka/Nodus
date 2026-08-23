//! Anthropic's own Messages API — not OpenAI-compatible (a separate
//! header scheme, and system prompts are a top-level field rather than a
//! message with a "system" role), so it gets its own client instead of
//! being folded into `openai_compatible`.

use std::time::Duration;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::error::{classify_error_response, classify_transport_error, ProviderError, Result};
use crate::provider::{ChatProvider, ChatRequest, ChatResponse, ChatUsage, ModelInfo, Role};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 4096;

pub struct AnthropicClient {
    base_url: String,
    api_key: String,
    client: reqwest::blocking::Client,
}

impl AnthropicClient {
    pub fn new(base_url: impl Into<String>, api_key: String) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("building the HTTP client cannot fail with no custom TLS config");
        Self { base_url, api_key, client }
    }

    pub fn commercial(api_key: String) -> Self {
        Self::new("https://api.anthropic.com", api_key)
    }

    fn request(&self, method: Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
    }
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<RawModel>,
}

#[derive(Deserialize)]
struct RawModel {
    id: String,
}

#[derive(Serialize)]
struct WireMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct WireRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<WireMessage<'a>>,
}

#[derive(Deserialize)]
struct CompletionResponse {
    content: Vec<ContentBlock>,
    #[serde(default)]
    usage: Option<WireUsage>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct WireUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

impl ChatProvider for AnthropicClient {
    fn list_models(&self) -> Result<Vec<ModelInfo>> {
        let resp = self
            .request(Method::GET, "/v1/models")
            .send()
            .map_err(|e| classify_transport_error(e, &self.base_url))?;
        let status = resp.status();
        let body = resp.text().map_err(|e| classify_transport_error(e, &self.base_url))?;
        if !status.is_success() {
            return Err(classify_error_response(status.as_u16(), &body, ""));
        }
        let parsed: ModelsResponse =
            serde_json::from_str(&body).map_err(|e| ProviderError::UnexpectedResponse(e.to_string()))?;
        Ok(parsed.data.into_iter().map(|m| ModelInfo { id: m.id }).collect())
    }

    fn complete(&self, request: &ChatRequest) -> Result<ChatResponse> {
        // Anthropic wants the system prompt as its own field, not a
        // message — pull every `Role::System` message out and join them,
        // in document order, ahead of the remaining conversation.
        let system: Vec<&str> = request
            .messages
            .iter()
            .filter(|m| m.role == Role::System)
            .map(|m| m.content.as_str())
            .collect();
        let system = if system.is_empty() { None } else { Some(system.join("\n\n")) };

        let messages: Vec<WireMessage> = request
            .messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|m| WireMessage { role: if m.role == Role::User { "user" } else { "assistant" }, content: &m.content })
            .collect();

        let wire = WireRequest {
            model: &request.model,
            max_tokens: request.max_output_tokens.unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS),
            system,
            messages,
        };
        let resp = self
            .request(Method::POST, "/v1/messages")
            .json(&wire)
            .send()
            .map_err(|e| classify_transport_error(e, &self.base_url))?;
        let status = resp.status();
        let body = resp.text().map_err(|e| classify_transport_error(e, &self.base_url))?;
        if !status.is_success() {
            return Err(classify_error_response(status.as_u16(), &body, &request.model));
        }
        let parsed: CompletionResponse =
            serde_json::from_str(&body).map_err(|e| ProviderError::UnexpectedResponse(e.to_string()))?;
        let content = parsed
            .content
            .into_iter()
            .filter(|b| b.kind == "text")
            .map(|b| b.text)
            .collect::<Vec<_>>()
            .join("");
        let usage = parsed
            .usage
            .map(|u| ChatUsage { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens })
            .unwrap_or_default();
        Ok(ChatResponse { content, usage })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::ChatMessage;

    fn spawn_server() -> (tiny_http::Server, String) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr();
        (server, format!("http://{addr}"))
    }

    fn respond_once(server: tiny_http::Server, status: u16, body: &'static str) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut request = server.recv().unwrap();
            let mut received = Vec::new();
            request.as_reader().read_to_end(&mut received).unwrap();
            let response = tiny_http::Response::from_string(body)
                .with_status_code(status)
                .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());
            request.respond(response).unwrap();
            received
        })
    }

    #[test]
    fn separates_the_system_prompt_from_messages_and_returns_a_real_reply() {
        let (server, url) = spawn_server();
        let handle = respond_once(
            server,
            200,
            r#"{"content": [{"type": "text", "text": "Hi there!"}], "usage": {"input_tokens": 20, "output_tokens": 4}}"#,
        );
        let client = AnthropicClient::new(url, "sk-ant-test".to_string());
        let request = ChatRequest {
            model: "claude-opus-5".to_string(),
            messages: vec![ChatMessage::system("Be concise."), ChatMessage::user("hi")],
            max_output_tokens: Some(100),
        };
        let response = client.complete(&request).unwrap();
        let received = String::from_utf8(handle.join().unwrap()).unwrap();

        assert_eq!(response.content, "Hi there!");
        assert_eq!(response.usage.prompt_tokens, 20);
        assert_eq!(response.usage.completion_tokens, 4);
        assert!(received.contains("\"system\":\"Be concise.\""));
        assert!(received.contains("\"role\":\"user\""));
        assert!(!received.contains("\"role\":\"system\""), "system must not appear inside messages: {received}");
    }

    #[test]
    fn sends_the_x_api_key_and_version_headers() {
        let (server, url) = spawn_server();
        let handle = std::thread::spawn(move || {
            let request = server.recv().unwrap();
            let headers: Vec<String> = request.headers().iter().map(|h| format!("{}: {}", h.field, h.value)).collect();
            let response = tiny_http::Response::from_string(
                r#"{"content": [{"type": "text", "text": "ok"}], "usage": {"input_tokens": 1, "output_tokens": 1}}"#,
            );
            request.respond(response).unwrap();
            headers
        });
        let client = AnthropicClient::new(url, "sk-ant-secret".to_string());
        client
            .complete(&ChatRequest { model: "claude-opus-5".to_string(), messages: vec![ChatMessage::user("hi")], max_output_tokens: None })
            .unwrap();
        let headers = handle.join().unwrap();
        assert!(headers.iter().any(|h| h.to_lowercase().contains("x-api-key: sk-ant-secret")));
        assert!(headers.iter().any(|h| h.to_lowercase().contains(&format!("anthropic-version: {ANTHROPIC_VERSION}"))));
    }

    #[test]
    fn a_quota_error_is_classified_as_such() {
        let (server, url) = spawn_server();
        let handle = respond_once(
            server,
            429,
            r#"{"type":"error","error":{"type":"rate_limit_error","message":"quota exceeded"}}"#,
        );
        let client = AnthropicClient::new(url, "sk-ant-test".to_string());
        let err = client.list_models().unwrap_err();
        handle.join().unwrap();
        assert!(matches!(err, ProviderError::QuotaExceeded));
    }
}

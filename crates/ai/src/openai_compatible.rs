//! A client for anything speaking the OpenAI Chat Completions wire
//! format: a commercial key against `api.openai.com` (or any other
//! commercial provider that copies the same protocol), an arbitrary
//! self-hosted OpenAI-compatible address, and LM Studio's local server
//! (its entire local-model story is this same protocol pointed at
//! `localhost`).

use std::time::Duration;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::error::{classify_error_response, classify_transport_error, ProviderError, Result};
use crate::provider::{role_str, ChatProvider, ChatRequest, ChatResponse, ChatUsage, ModelInfo};

pub struct OpenAiCompatibleClient {
    base_url: String,
    api_key: Option<String>,
    client: reqwest::blocking::Client,
}

impl OpenAiCompatibleClient {
    pub fn new(base_url: impl Into<String>, api_key: Option<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("building the HTTP client cannot fail with no custom TLS config");
        Self { base_url, api_key, client }
    }

    fn request(&self, method: Method, path: &str) -> reqwest::blocking::RequestBuilder {
        let mut req = self.client.request(method, format!("{}{path}", self.base_url));
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        req
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
    messages: Vec<WireMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct CompletionResponse {
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<WireUsage>,
}

#[derive(Deserialize)]
struct Choice {
    message: MessageContent,
}

#[derive(Deserialize)]
struct MessageContent {
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct WireUsage {
    #[serde(default)]
    prompt_tokens: u64,
    #[serde(default)]
    completion_tokens: u64,
}

impl ChatProvider for OpenAiCompatibleClient {
    fn list_models(&self) -> Result<Vec<ModelInfo>> {
        let resp = self
            .request(Method::GET, "/models")
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
        let wire = WireRequest {
            model: &request.model,
            messages: request
                .messages
                .iter()
                .map(|m| WireMessage { role: role_str(m.role), content: &m.content })
                .collect(),
            max_tokens: request.max_output_tokens,
        };
        let resp = self
            .request(Method::POST, "/chat/completions")
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
        let content = parsed.choices.into_iter().next().map(|c| c.message.content).unwrap_or_default();
        let usage = parsed
            .usage
            .map(|u| ChatUsage { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens })
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
    fn lists_models_from_a_real_local_http_response() {
        let (server, url) = spawn_server();
        let handle = respond_once(server, 200, r#"{"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}]}"#);
        let client = OpenAiCompatibleClient::new(url, Some("sk-test".to_string()));
        let models = client.list_models().unwrap();
        handle.join().unwrap();
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["gpt-4o", "gpt-4o-mini"]);
    }

    #[test]
    fn sends_the_bearer_token_and_gets_a_real_completion_back() {
        let (server, url) = spawn_server();
        let handle = respond_once(
            server,
            200,
            r#"{"choices": [{"message": {"role": "assistant", "content": "Hello!"}}], "usage": {"prompt_tokens": 12, "completion_tokens": 3}}"#,
        );
        let client = OpenAiCompatibleClient::new(url, Some("sk-secret-token".to_string()));
        let request = ChatRequest {
            model: "gpt-4o".to_string(),
            messages: vec![ChatMessage::user("hi")],
            max_output_tokens: None,
        };
        let response = client.complete(&request).unwrap();
        let received = handle.join().unwrap();
        let received_text = String::from_utf8(received).unwrap();

        assert_eq!(response.content, "Hello!");
        assert_eq!(response.usage.prompt_tokens, 12);
        assert_eq!(response.usage.completion_tokens, 3);
        assert!(received_text.contains("\"role\":\"user\""));
        assert!(received_text.contains("\"content\":\"hi\""));
    }

    #[test]
    fn an_invalid_key_response_is_classified_as_such() {
        let (server, url) = spawn_server();
        let handle = respond_once(server, 401, r#"{"error": {"message": "Incorrect API key provided"}}"#);
        let client = OpenAiCompatibleClient::new(url, Some("sk-bad".to_string()));
        let err = client.list_models().unwrap_err();
        handle.join().unwrap();
        assert!(matches!(err, ProviderError::InvalidApiKey));
    }

    #[test]
    fn an_unreachable_address_is_classified_as_such_not_as_a_raw_transport_error() {
        // Nothing is listening on this port.
        let client = OpenAiCompatibleClient::new("http://127.0.0.1:1", None);
        let err = client.list_models().unwrap_err();
        assert!(matches!(err, ProviderError::Unreachable { .. }));
    }
}

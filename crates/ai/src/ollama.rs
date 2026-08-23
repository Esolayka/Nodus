//! Ollama's native local API — chosen over its OpenAI-compatibility shim
//! because `/api/tags` gives a cleaner, more complete picture of what's
//! actually pulled locally than an OpenAI-style `/v1/models` list would.
//! No API key: a local Ollama install has nothing to authenticate
//! against, which is exactly the point of this connection method — not
//! one character leaves the machine.

use std::time::Duration;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::error::{classify_error_response, classify_transport_error, ProviderError, Result};
use crate::provider::{role_str, ChatProvider, ChatRequest, ChatResponse, ChatUsage, ModelInfo};

pub struct OllamaClient {
    address: String,
    client: reqwest::blocking::Client,
}

impl OllamaClient {
    pub fn new(address: impl Into<String>) -> Self {
        let address = address.into().trim_end_matches('/').to_string();
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("building the HTTP client cannot fail with no custom TLS config");
        Self { address, client }
    }

    fn request(&self, method: Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.client.request(method, format!("{}{path}", self.address))
    }
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<RawModel>,
}

#[derive(Deserialize)]
struct RawModel {
    name: String,
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
    stream: bool,
}

#[derive(Deserialize)]
struct ChatResponseWire {
    message: WireResponseMessage,
    #[serde(default)]
    prompt_eval_count: u64,
    #[serde(default)]
    eval_count: u64,
}

#[derive(Deserialize)]
struct WireResponseMessage {
    #[serde(default)]
    content: String,
}

impl ChatProvider for OllamaClient {
    fn list_models(&self) -> Result<Vec<ModelInfo>> {
        let resp = self
            .request(Method::GET, "/api/tags")
            .send()
            .map_err(|e| classify_transport_error(e, &self.address))?;
        let status = resp.status();
        let body = resp.text().map_err(|e| classify_transport_error(e, &self.address))?;
        if !status.is_success() {
            return Err(classify_error_response(status.as_u16(), &body, ""));
        }
        let parsed: TagsResponse =
            serde_json::from_str(&body).map_err(|e| ProviderError::UnexpectedResponse(e.to_string()))?;
        Ok(parsed.models.into_iter().map(|m| ModelInfo { id: m.name }).collect())
    }

    fn complete(&self, request: &ChatRequest) -> Result<ChatResponse> {
        let wire = WireRequest {
            model: &request.model,
            messages: request
                .messages
                .iter()
                .map(|m| WireMessage { role: role_str(m.role), content: &m.content })
                .collect(),
            stream: false,
        };
        let resp = self
            .request(Method::POST, "/api/chat")
            .json(&wire)
            .send()
            .map_err(|e| classify_transport_error(e, &self.address))?;
        let status = resp.status();
        let body = resp.text().map_err(|e| classify_transport_error(e, &self.address))?;
        if !status.is_success() {
            return Err(classify_error_response(status.as_u16(), &body, &request.model));
        }
        let parsed: ChatResponseWire =
            serde_json::from_str(&body).map_err(|e| ProviderError::UnexpectedResponse(e.to_string()))?;
        Ok(ChatResponse {
            content: parsed.message.content,
            usage: ChatUsage { prompt_tokens: parsed.prompt_eval_count, completion_tokens: parsed.eval_count },
        })
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
    fn lists_locally_pulled_models_by_name() {
        let (server, url) = spawn_server();
        let handle = respond_once(
            server,
            200,
            r#"{"models": [{"name": "llama3:8b", "size": 123}, {"name": "mistral:latest", "size": 456}]}"#,
        );
        let client = OllamaClient::new(url);
        let models = client.list_models().unwrap();
        handle.join().unwrap();
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["llama3:8b", "mistral:latest"]);
    }

    #[test]
    fn completes_a_chat_with_no_authentication_header_at_all() {
        let (server, url) = spawn_server();
        let handle = std::thread::spawn(move || {
            let mut request = server.recv().unwrap();
            let has_auth_header = request.headers().iter().any(|h| h.field.as_str().as_str().eq_ignore_ascii_case("authorization"));
            let mut received = Vec::new();
            request.as_reader().read_to_end(&mut received).unwrap();
            let response = tiny_http::Response::from_string(
                r#"{"message": {"role": "assistant", "content": "Hello from Ollama"}, "prompt_eval_count": 8, "eval_count": 5}"#,
            );
            request.respond(response).unwrap();
            (has_auth_header, received)
        });
        let client = OllamaClient::new(url);
        let response = client
            .complete(&ChatRequest { model: "llama3:8b".to_string(), messages: vec![ChatMessage::user("hi")], max_output_tokens: None })
            .unwrap();
        let (has_auth_header, received) = handle.join().unwrap();
        let received_text = String::from_utf8(received).unwrap();

        assert_eq!(response.content, "Hello from Ollama");
        assert_eq!(response.usage.prompt_tokens, 8);
        assert_eq!(response.usage.completion_tokens, 5);
        assert!(!has_auth_header, "a local Ollama request must carry no credentials");
        assert!(received_text.contains("\"stream\":false"));
    }

    #[test]
    fn an_unreachable_ollama_address_is_classified_as_such() {
        let client = OllamaClient::new("http://127.0.0.1:1");
        let err = client.list_models().unwrap_err();
        assert!(matches!(err, ProviderError::Unreachable { .. }));
    }
}

//! Turns a user's chosen connection method into the right client. This
//! is the one place that knows "Ollama and LM Studio are both `Local`,
//! but LM Studio actually speaks the OpenAI-compatible protocol" and
//! similar wiring — everything else just holds a `Box<dyn ChatProvider>`.

use crate::anthropic::AnthropicClient;
use crate::ollama::OllamaClient;
use crate::openai_compatible::OpenAiCompatibleClient;
use crate::provider::ChatProvider;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatProtocol {
    OpenAiCompatible,
    Anthropic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalBackend {
    Ollama,
    LmStudio,
}

/// The three connection methods from the spec, in the order they should
/// be offered: local first ("best matches the project's spirit"), then
/// a commercial key, then an arbitrary address.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ConnectionMethod {
    Local { backend: LocalBackend, address: String },
    Commercial { protocol: ChatProtocol, base_url: String },
    Custom { base_url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSettings {
    pub connection: ConnectionMethod,
    pub model: String,
}

pub fn default_base_url_for_protocol(protocol: ChatProtocol) -> &'static str {
    match protocol {
        ChatProtocol::OpenAiCompatible => "https://api.openai.com/v1",
        ChatProtocol::Anthropic => "https://api.anthropic.com",
    }
}

pub fn default_address_for_local_backend(backend: LocalBackend) -> &'static str {
    match backend {
        LocalBackend::Ollama => "http://localhost:11434",
        LocalBackend::LmStudio => "http://localhost:1234/v1",
    }
}

impl ConnectionMethod {
    /// A stable id per *kind* of connection (not per exact address/model)
    /// so a stored key survives switching base URLs, and switching back
    /// to a previously-configured method finds its key again rather than
    /// asking the user to retype it.
    pub fn keyring_id(&self) -> &'static str {
        match self {
            ConnectionMethod::Commercial { protocol: ChatProtocol::OpenAiCompatible, .. } => "commercial-openai-compatible",
            ConnectionMethod::Commercial { protocol: ChatProtocol::Anthropic, .. } => "commercial-anthropic",
            ConnectionMethod::Local { .. } => "local",
            ConnectionMethod::Custom { .. } => "custom",
        }
    }

    /// Whether this connection method ever needs an API key at all — a
    /// local install has nothing to authenticate against, and asking for
    /// a key it would never use would be actively misleading.
    pub fn needs_api_key(&self) -> bool {
        !matches!(self, ConnectionMethod::Local { .. })
    }

    pub fn provider_label(&self, model: &str) -> String {
        match self {
            ConnectionMethod::Commercial { protocol: ChatProtocol::OpenAiCompatible, .. } => "OpenAI-compatible".to_string(),
            ConnectionMethod::Commercial { protocol: ChatProtocol::Anthropic, .. } => "Anthropic".to_string(),
            ConnectionMethod::Local { backend: LocalBackend::Ollama, .. } => format!("Ollama ({model})"),
            ConnectionMethod::Local { backend: LocalBackend::LmStudio, .. } => format!("LM Studio ({model})"),
            ConnectionMethod::Custom { base_url } => format!("Custom ({base_url})"),
        }
    }

    /// This connection method's own request preview default, per the
    /// spec: cloud providers show the outgoing request before it's sent
    /// by default, local ones don't (there's nothing to be cautious
    /// about when nothing leaves the machine).
    pub fn preview_before_sending_by_default(&self) -> bool {
        !matches!(self, ConnectionMethod::Local { .. })
    }
}

/// Builds the client for `settings.connection`. `api_key` is ignored for
/// `Local` (never needed) and for LM Studio specifically (also never
/// needed in the common case, though a user-supplied key is passed
/// through if LM Studio was put behind its own auth).
pub fn build_provider(settings: &ProviderSettings, api_key: Option<String>) -> Box<dyn ChatProvider> {
    match &settings.connection {
        ConnectionMethod::Commercial { protocol: ChatProtocol::OpenAiCompatible, base_url } => {
            Box::new(OpenAiCompatibleClient::new(base_url.clone(), api_key))
        }
        ConnectionMethod::Commercial { protocol: ChatProtocol::Anthropic, base_url } => {
            Box::new(AnthropicClient::new(base_url.clone(), api_key.unwrap_or_default()))
        }
        ConnectionMethod::Local { backend: LocalBackend::Ollama, address } => Box::new(OllamaClient::new(address.clone())),
        ConnectionMethod::Local { backend: LocalBackend::LmStudio, address } => {
            Box::new(OpenAiCompatibleClient::new(address.clone(), api_key))
        }
        ConnectionMethod::Custom { base_url } => Box::new(OpenAiCompatibleClient::new(base_url.clone(), api_key)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{ChatMessage, ChatRequest};

    fn spawn_server() -> (tiny_http::Server, String) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr();
        (server, format!("http://{addr}"))
    }

    #[test]
    fn local_ollama_never_needs_a_key_and_previews_are_off_by_default() {
        let connection = ConnectionMethod::Local { backend: LocalBackend::Ollama, address: "http://localhost:11434".to_string() };
        assert!(!connection.needs_api_key());
        assert!(!connection.preview_before_sending_by_default());
    }

    #[test]
    fn commercial_and_custom_need_a_key_and_preview_by_default() {
        let commercial = ConnectionMethod::Commercial { protocol: ChatProtocol::Anthropic, base_url: "https://api.anthropic.com".to_string() };
        assert!(commercial.needs_api_key());
        assert!(commercial.preview_before_sending_by_default());

        let custom = ConnectionMethod::Custom { base_url: "https://my-server.example".to_string() };
        assert!(custom.needs_api_key());
        assert!(custom.preview_before_sending_by_default());
    }

    #[test]
    fn switching_connection_kind_and_back_keeps_the_keyring_id_stable() {
        let a = ConnectionMethod::Commercial { protocol: ChatProtocol::OpenAiCompatible, base_url: "https://api.openai.com/v1".to_string() };
        let b = ConnectionMethod::Commercial {
            protocol: ChatProtocol::OpenAiCompatible,
            base_url: "https://a-different-openai-compatible-host.example".to_string(),
        };
        assert_eq!(a.keyring_id(), b.keyring_id(), "the key should follow the connection kind, not the exact address");
    }

    #[test]
    fn builds_an_ollama_client_that_actually_talks_to_ollamas_native_endpoint() {
        let (server, url) = spawn_server();
        let handle = std::thread::spawn(move || {
            let mut request = server.recv().unwrap();
            let path = request.url().to_string();
            let mut body = Vec::new();
            request.as_reader().read_to_end(&mut body).unwrap();
            request.respond(tiny_http::Response::from_string(r#"{"models": [{"name": "llama3:8b"}]}"#)).unwrap();
            path
        });
        let settings = ProviderSettings {
            connection: ConnectionMethod::Local { backend: LocalBackend::Ollama, address: url },
            model: "llama3:8b".to_string(),
        };
        let provider = build_provider(&settings, None);
        let models = provider.list_models().unwrap();
        let path = handle.join().unwrap();
        assert_eq!(path, "/api/tags");
        assert_eq!(models[0].id, "llama3:8b");
    }

    #[test]
    fn builds_a_commercial_openai_client_that_sends_the_bearer_key() {
        let (server, url) = spawn_server();
        let handle = std::thread::spawn(move || {
            let request = server.recv().unwrap();
            let auth = request
                .headers()
                .iter()
                .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("authorization"))
                .map(|h| h.value.as_str().to_string());
            request.respond(tiny_http::Response::from_string(r#"{"data": [{"id": "gpt-4o"}]}"#)).unwrap();
            auth
        });
        let settings = ProviderSettings {
            connection: ConnectionMethod::Commercial { protocol: ChatProtocol::OpenAiCompatible, base_url: url },
            model: "gpt-4o".to_string(),
        };
        let provider = build_provider(&settings, Some("sk-secret".to_string()));
        provider.list_models().unwrap();
        let auth = handle.join().unwrap();
        assert_eq!(auth.as_deref(), Some("Bearer sk-secret"));
    }

    #[test]
    fn builds_an_anthropic_client_end_to_end_through_the_factory() {
        let (server, url) = spawn_server();
        let handle = std::thread::spawn(move || {
            let request = server.recv().unwrap();
            let has_version_header = request
                .headers()
                .iter()
                .any(|h| h.field.as_str().as_str().eq_ignore_ascii_case("anthropic-version"));
            request.respond(tiny_http::Response::from_string(r#"{"data": [{"id": "claude-opus-5"}]}"#)).unwrap();
            has_version_header
        });
        let settings = ProviderSettings {
            connection: ConnectionMethod::Commercial { protocol: ChatProtocol::Anthropic, base_url: url },
            model: "claude-opus-5".to_string(),
        };
        let provider = build_provider(&settings, Some("sk-ant-secret".to_string()));
        let models = provider.list_models().unwrap();
        assert!(handle.join().unwrap());
        assert_eq!(models[0].id, "claude-opus-5");
    }

    #[test]
    fn provider_label_names_the_local_model_for_the_log() {
        let ollama = ConnectionMethod::Local { backend: LocalBackend::Ollama, address: "http://localhost:11434".to_string() };
        assert_eq!(ollama.provider_label("llama3:8b"), "Ollama (llama3:8b)");
    }

    #[test]
    fn a_completion_request_can_round_trip_through_the_factory_too() {
        let (server, url) = spawn_server();
        let handle = std::thread::spawn(move || {
            let request = server.recv().unwrap();
            request
                .respond(tiny_http::Response::from_string(
                    r#"{"choices": [{"message": {"content": "hi back"}}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}"#,
                ))
                .unwrap();
        });
        let settings = ProviderSettings {
            connection: ConnectionMethod::Custom { base_url: url },
            model: "local-model".to_string(),
        };
        let provider = build_provider(&settings, None);
        let response = provider
            .complete(&ChatRequest { model: "local-model".to_string(), messages: vec![ChatMessage::user("hi")], max_output_tokens: None })
            .unwrap();
        handle.join().unwrap();
        assert_eq!(response.content, "hi back");
    }
}

//! Shared vocabulary every provider client speaks, regardless of which
//! of the three connection methods it came from (a commercial key, a
//! local Ollama/LM Studio install, or an arbitrary OpenAI-compatible
//! address) — callers build one `ChatRequest` and get one `ChatResponse`
//! shape back either way.

use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: Role::System, content: content.into() }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self { role: Role::User, content: content.into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    /// A cap on the reply's own length — distinct from the context-window
    /// truncation applied to the *input* before it ever gets here.
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ChatUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub usage: ChatUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
}

/// One real HTTP round trip in either direction: list what models a
/// provider currently has (never hardcoded — pulled live, since a static
/// list goes stale the moment the provider adds or retires a model), and
/// send one chat completion.
pub trait ChatProvider {
    fn list_models(&self) -> Result<Vec<ModelInfo>>;
    fn complete(&self, request: &ChatRequest) -> Result<ChatResponse>;

    /// The "test connection" button's real minimal request: listing
    /// models costs nothing and still proves the key and address both
    /// work, unlike a throwaway chat completion that would burn quota
    /// just to say "ok".
    fn test_connection(&self) -> Result<Vec<ModelInfo>> {
        self.list_models()
    }
}

pub(crate) fn role_str(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

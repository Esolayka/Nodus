//! The AI-assistant module's provider layer: user-supplied connections
//! only. There is no bundled key and no Nodus-run server in this crate —
//! every client here talks directly to whatever the user configured
//! (their own commercial key, a local Ollama/LM Studio install, or an
//! arbitrary OpenAI-compatible address), and nothing is sent anywhere
//! until the caller explicitly asks for a completion.

pub mod anthropic;
pub mod chunking;
pub mod context;
pub mod embeddings;
pub mod error;
pub mod log;
pub mod ollama;
pub mod openai_compatible;
pub mod provider;
pub mod secrets;
pub mod settings;
pub mod vector_store;

pub use anthropic::AnthropicClient;
pub use chunking::{chunk_text, TextChunk};
pub use embeddings::{Embedder, EmbeddingError, EMBEDDING_DIMENSIONS};
pub use error::{ProviderError, Result};
pub use log::{LogEntry, NewLogEntry, RequestLog};
pub use ollama::OllamaClient;
pub use openai_compatible::OpenAiCompatibleClient;
pub use provider::{ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatUsage, ModelInfo, Role};
pub use settings::{build_provider, ChatProtocol, ConnectionMethod, LocalBackend, ProviderSettings};
pub use vector_store::{hash_content, ChunkMatch, VectorStore, VectorStoreError};

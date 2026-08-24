//! The local embedding model: small (~23MB, quantized), CPU-only, and
//! loaded from `fastembed`'s all-MiniLM-L6-v2 — nothing cloud-based here
//! even in principle, since sending the whole vault's content to a
//! remote embedding API would be exactly the privacy violation local
//! search exists to avoid.
//!
//! The model weights are fetched once into `cache_dir` (from Hugging
//! Face) the first time semantic search is enabled, then loaded from
//! that same local cache on every run after — no network involved
//! again unless the cache is deleted. Every chunk this crate computes a
//! vector for feeds only its own text through the model; nothing about
//! it is transmitted anywhere.

use std::path::Path;

use fastembed::{EmbeddingModel as FastEmbedModel, InitOptions, TextEmbedding};

pub const EMBEDDING_DIMENSIONS: usize = 384;

#[derive(Debug, thiserror::Error)]
pub enum EmbeddingError {
    #[error("couldn't load the local embedding model: {0}")]
    Init(String),
    #[error("computing the embedding failed: {0}")]
    Inference(String),
}

pub type Result<T> = std::result::Result<T, EmbeddingError>;

pub struct Embedder {
    model: TextEmbedding,
}

impl Embedder {
    /// Loads the model from `cache_dir`, downloading it there first if
    /// this is the very first time (the one-time network access the
    /// "enable semantic search" setting warns the user about).
    pub fn load(cache_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(cache_dir).map_err(|e| EmbeddingError::Init(e.to_string()))?;
        let options = InitOptions::new(FastEmbedModel::AllMiniLML6V2Q)
            .with_cache_dir(cache_dir.to_path_buf())
            .with_show_download_progress(false);
        let model =
            TextEmbedding::try_new(options).map_err(|e| EmbeddingError::Init(e.to_string()))?;
        Ok(Self { model })
    }

    pub fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>> {
        self.model
            .embed(texts, None)
            .map_err(|e| EmbeddingError::Inference(e.to_string()))
    }

    pub fn embed_one(&self, text: &str) -> Result<Vec<f32>> {
        let mut vectors = self.embed(vec![text.to_string()])?;
        Ok(vectors.pop().unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A persistent cache under `target/` (not a fresh tempdir) so the
    /// ~23MB model is downloaded once per workspace, not once per test
    /// run — this test genuinely exercises the real model, not a stub.
    fn shared_cache_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../target/ai-embedding-test-cache"
        ))
    }

    #[test]
    fn produces_a_384_dimensional_vector_for_real_text() {
        let embedder = Embedder::load(&shared_cache_dir())
            .expect("model should load (downloading once if needed)");
        let vector = embedder
            .embed_one("Nodus keeps your notes private and local.")
            .unwrap();
        assert_eq!(vector.len(), EMBEDDING_DIMENSIONS);
        assert!(
            vector.iter().any(|v| *v != 0.0),
            "the vector should not be all zeros"
        );
    }

    #[test]
    fn similar_sentences_score_closer_than_unrelated_ones() {
        let embedder = Embedder::load(&shared_cache_dir())
            .expect("model should load (downloading once if needed)");
        let vectors = embedder
            .embed(vec![
                "The cat sat on the warm windowsill in the sun.".to_string(),
                "A kitten was napping on the sunny window ledge.".to_string(),
                "Quarterly tax filings are due at the end of the month.".to_string(),
            ])
            .unwrap();

        let cosine = |a: &[f32], b: &[f32]| -> f32 {
            let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
            let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
            let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
            dot / (na * nb)
        };

        let cats_similarity = cosine(&vectors[0], &vectors[1]);
        let unrelated_similarity = cosine(&vectors[0], &vectors[2]);
        assert!(
            cats_similarity > unrelated_similarity,
            "two sentences about a cat napping ({cats_similarity}) should score closer than one about tax filings ({unrelated_similarity})"
        );
    }
}

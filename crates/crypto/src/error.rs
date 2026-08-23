use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    /// Wrong password, wrong recovery phrase, or the wrapped key / ciphertext
    /// was tampered with — Argon2id and AEAD authentication failures are
    /// deliberately not distinguished from each other in the public error,
    /// so a timing or error-message side channel can't be used to tell
    /// "wrong password" apart from "corrupted data".
    #[error("decryption failed: wrong password/phrase, or the data was tampered with")]
    DecryptionFailed,
    #[error("invalid recovery phrase")]
    InvalidRecoveryPhrase,
    #[error("key derivation failed: {0}")]
    Kdf(String),
    #[error("malformed ciphertext")]
    MalformedCiphertext,
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

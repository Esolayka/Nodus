//! End-to-end encryption for Nodus's sync layer.
//!
//! Scope, deliberately narrow: this crate encrypts *data leaving the
//! device* for a sync target. It has no opinion about local files, which
//! stay ordinary Markdown on disk regardless of whether encryption is
//! turned on — that's a project-wide principle, not something this crate
//! enforces itself.
//!
//! The moving parts:
//! - [`kdf`] — Argon2id, turning a password or recovery phrase into a key.
//! - [`keys`] — the vault's one real content-encryption key (the DEK),
//!   generated at random and wrapped under one KEK per unlock method.
//! - [`content`] — the AEAD primitive (XChaCha20-Poly1305) both file
//!   content and the DEK's own wrapping are encrypted with.
//! - [`paths`] — deterministic, non-reversible file identifiers plus
//!   encrypted real paths, so a sync server never sees a vault's structure
//!   or note titles.
//! - [`chunk`] — splits large blobs into fixed-size, independently
//!   encrypted pieces, so the sync server can transfer only the pieces
//!   that changed. A byte-level delta against ciphertext can't work (a
//!   fresh nonce changes every byte on any edit), so chunking happens
//!   before encryption instead.
//! - [`recovery`] — the independent second unlock method.
//! - [`config`] — the one file that's actually persisted, tying the above
//!   together.
//! - [`discovery`] — a vault's private, DEK-independent identity for
//!   finding its own devices through an untrusted discovery service.

pub mod chunk;
pub mod config;
pub mod content;
pub mod discovery;
pub mod error;
pub mod kdf;
pub mod keys;
pub mod paths;
pub mod recovery;

pub use config::VaultCryptoConfig;
pub use discovery::SyncIdentity;
pub use error::{Error, Result};
pub use keys::Dek;
pub use recovery::RecoveryPhrase;

//! Telegram integration, kept separate from the vault/sync crates since it
//! has nothing to do with either: verifying what Telegram itself signs
//! ([`init_data`]) for the Mini App, and (eventually) a small Bot API
//! client for the companion bot that drops forwarded messages into
//! today's note.

pub mod init_data;

pub use init_data::{TelegramUser, VerifiedInitData, VerifyError};

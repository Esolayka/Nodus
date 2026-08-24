//! Linking a Telegram account to this vault. Two things have to be proven
//! before anything is handed over: that the Mini App session claiming to
//! be "the same person looking at this desktop" really is (a short-lived
//! code shown on screen, entered or scanned in the Mini App), and that the
//! Mini App session really is Telegram (verifying Telegram's own signature
//! on `initData` — see [`nodus_telegram::init_data`]). Once both hold, the
//! Mini App receives this vault's sync identity — the same secret
//! [`nodus_crypto::discovery`] uses to find this device through an
//! untrusted discovery service — so it never has to be sent again.

pub mod error;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use nodus_crypto::SyncIdentity;
use rand::Rng;

pub use error::{Result, TelegramLinkError};

fn identity_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".nodus").join("sync-identity.json")
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before 1970")
        .as_secs() as i64
}

/// Loads this vault's sync identity, generating and persisting one on the
/// first call. Independent of vault content encryption — it exists purely
/// so this vault's own devices can find each other through a discovery
/// service that never sees the identity itself.
pub fn load_or_create_identity(vault_root: &Path) -> Result<SyncIdentity> {
    let path = identity_path(vault_root);
    if let Ok(hex_str) = std::fs::read_to_string(&path) {
        if let Some(identity) = decode_identity(hex_str.trim()) {
            return Ok(identity);
        }
    }
    let identity = SyncIdentity::generate();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, hex::encode(identity.0))?;
    Ok(identity)
}

fn decode_identity(hex_str: &str) -> Option<SyncIdentity> {
    let bytes = hex::decode(hex_str).ok()?;
    let array: [u8; 32] = bytes.try_into().ok()?;
    Some(SyncIdentity(array))
}

const LINKING_TOKEN_TTL_SECS: i64 = 600;
const TOKEN_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/// How stale a Mini App launch's `initData` may be by the time it reaches
/// this handshake — generous enough for a user to read a code and type it
/// in, tight enough that a captured `initData` is useless minutes later.
const INIT_DATA_MAX_AGE_SECS: i64 = 300;

#[derive(Debug, Clone)]
pub struct PendingLink {
    pub token: String,
    pub expires_at: i64,
}

/// Generates a short, single-use code the user enters (or scans, as a
/// Telegram deep link) in the Mini App to prove they're looking at this
/// exact desktop session, not someone else's.
pub fn generate_linking_token() -> PendingLink {
    let mut rng = rand::thread_rng();
    let token: String = (0..8)
        .map(|_| TOKEN_ALPHABET[rng.gen_range(0..TOKEN_ALPHABET.len())] as char)
        .collect();
    PendingLink {
        token,
        expires_at: now() + LINKING_TOKEN_TTL_SECS,
    }
}

#[derive(Debug, Clone)]
pub struct LinkResult {
    pub telegram_user_id: i64,
    pub telegram_username: Option<String>,
    /// This vault's sync identity, hex-encoded — handed over exactly once,
    /// over the tunnel-protected connection this handshake already runs
    /// through. From here on the Mini App derives everything it needs
    /// (its own discovery lookups) locally, the same way the desktop does.
    pub sync_identity_hex: String,
}

/// Completes a linking handshake: the token proves this is the same
/// session that showed the code; `initData`'s signature proves this really
/// is Telegram. Both must hold, or nothing is handed over.
pub fn complete_link(
    pending: &PendingLink,
    provided_token: &str,
    init_data: &str,
    bot_token: &str,
    identity: &SyncIdentity,
) -> Result<LinkResult> {
    let current = now();
    if current > pending.expires_at {
        return Err(TelegramLinkError::TokenExpired);
    }
    if provided_token != pending.token {
        return Err(TelegramLinkError::TokenMismatch);
    }
    let verified =
        nodus_telegram::init_data::verify(init_data, bot_token, current, INIT_DATA_MAX_AGE_SECS)?;
    Ok(LinkResult {
        telegram_user_id: verified.user.id,
        telegram_username: verified.user.username,
        sync_identity_hex: hex::encode(identity.0),
    })
}

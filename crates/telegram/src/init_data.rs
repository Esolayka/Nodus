//! Verifying the signed launch data Telegram hands a Mini App on startup —
//! the only way a backend can trust "this really is Telegram user 12345,"
//! rather than whatever a client claims to be. Every Mini App backend
//! needs this exact check (HMAC-SHA256, keyed by a hash of the bot token)
//! before treating anything in `initData` as authentic. Skipping it means
//! anyone can forge a user id.

use hmac::{Hmac, Mac};
use percent_encoding::percent_decode_str;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum VerifyError {
    #[error("initData has no hash field")]
    MissingHash,
    #[error("initData signature does not match")]
    BadSignature,
    #[error("initData has no auth_date field")]
    MissingAuthDate,
    #[error("initData is too old")]
    Expired,
    #[error("initData has no user field")]
    MissingUser,
    #[error("initData user field is not valid JSON")]
    InvalidUser,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TelegramUser {
    pub id: i64,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub username: Option<String>,
}

#[derive(Debug, Clone)]
pub struct VerifiedInitData {
    pub user: TelegramUser,
    pub auth_date: i64,
}

/// Parses and verifies a Mini App's `initData` string against `bot_token`,
/// rejecting anything older than `max_age_secs` (a fresh launch check
/// wants this tight — a few minutes; a long-lived linking code embedded in
/// a QR is a separate, explicit TTL, not this one). Never trust `user` (or
/// anything else in `initData`) without calling this first.
pub fn verify(
    init_data: &str,
    bot_token: &str,
    now: i64,
    max_age_secs: i64,
) -> Result<VerifiedInitData, VerifyError> {
    let mut pairs: Vec<(String, String)> = Vec::new();
    let mut hash: Option<String> = None;

    for pair in init_data.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let raw_value = parts.next().unwrap_or_default();
        let value = percent_decode_str(raw_value)
            .decode_utf8_lossy()
            .into_owned();
        if key == "hash" {
            hash = Some(value);
        } else {
            pairs.push((key.to_string(), value));
        }
    }

    let hash = hash.ok_or(VerifyError::MissingHash)?;
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    let data_check_string = pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\n");

    let mut secret_mac =
        HmacSha256::new_from_slice(b"WebAppData").expect("HMAC accepts any key length");
    secret_mac.update(bot_token.as_bytes());
    let secret_key = secret_mac.finalize().into_bytes();

    let mut data_mac =
        HmacSha256::new_from_slice(&secret_key).expect("HMAC accepts any key length");
    data_mac.update(data_check_string.as_bytes());
    let computed = hex::encode(data_mac.finalize().into_bytes());

    if !constant_time_eq(computed.as_bytes(), hash.as_bytes()) {
        return Err(VerifyError::BadSignature);
    }

    let auth_date: i64 = pairs
        .iter()
        .find(|(k, _)| k == "auth_date")
        .and_then(|(_, v)| v.parse().ok())
        .ok_or(VerifyError::MissingAuthDate)?;
    if now - auth_date > max_age_secs {
        return Err(VerifyError::Expired);
    }

    let user_json = pairs
        .iter()
        .find(|(k, _)| k == "user")
        .map(|(_, v)| v.clone())
        .ok_or(VerifyError::MissingUser)?;
    let user: TelegramUser =
        serde_json::from_str(&user_json).map_err(|_| VerifyError::InvalidUser)?;

    Ok(VerifiedInitData { user, auth_date })
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a genuinely valid `initData` string the exact way Telegram's
    /// client SDK does, so tests exercise the real algorithm rather than a
    /// simplified stand-in.
    fn build_init_data(bot_token: &str, user_json: &str, auth_date: i64) -> String {
        let mut pairs = [
            ("auth_date".to_string(), auth_date.to_string()),
            ("user".to_string(), user_json.to_string()),
        ];
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        let data_check_string = pairs
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("\n");

        let mut secret_mac = HmacSha256::new_from_slice(b"WebAppData").unwrap();
        secret_mac.update(bot_token.as_bytes());
        let secret_key = secret_mac.finalize().into_bytes();
        let mut data_mac = HmacSha256::new_from_slice(&secret_key).unwrap();
        data_mac.update(data_check_string.as_bytes());
        let hash = hex::encode(data_mac.finalize().into_bytes());

        format!(
            "auth_date={auth_date}&user={}&hash={hash}",
            percent_encoding::utf8_percent_encode(user_json, percent_encoding::NON_ALPHANUMERIC)
        )
    }

    #[test]
    fn a_genuinely_signed_init_data_verifies() {
        let init_data = build_init_data(
            "123:ABC-token",
            r#"{"id":42,"first_name":"Ann"}"#,
            1_000_000,
        );
        let result = verify(&init_data, "123:ABC-token", 1_000_050, 300).unwrap();
        assert_eq!(result.user.id, 42);
        assert_eq!(result.user.first_name, "Ann");
    }

    #[test]
    fn a_tampered_user_id_fails_verification() {
        let init_data = build_init_data(
            "123:ABC-token",
            r#"{"id":42,"first_name":"Ann"}"#,
            1_000_000,
        );
        let tampered = init_data.replace("42", "99999");
        assert_eq!(
            verify(&tampered, "123:ABC-token", 1_000_050, 300).unwrap_err(),
            VerifyError::BadSignature
        );
    }

    #[test]
    fn the_wrong_bot_token_fails_verification() {
        let init_data = build_init_data(
            "123:ABC-token",
            r#"{"id":42,"first_name":"Ann"}"#,
            1_000_000,
        );
        assert_eq!(
            verify(&init_data, "999:WRONG-token", 1_000_050, 300).unwrap_err(),
            VerifyError::BadSignature
        );
    }

    #[test]
    fn init_data_older_than_max_age_is_rejected() {
        let init_data = build_init_data(
            "123:ABC-token",
            r#"{"id":42,"first_name":"Ann"}"#,
            1_000_000,
        );
        assert_eq!(
            verify(&init_data, "123:ABC-token", 1_000_000 + 301, 300).unwrap_err(),
            VerifyError::Expired
        );
    }

    #[test]
    fn missing_hash_is_rejected() {
        assert_eq!(
            verify("auth_date=1000000&user=%7B%7D", "any-token", 1_000_000, 300).unwrap_err(),
            VerifyError::MissingHash
        );
    }
}

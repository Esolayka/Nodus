use hmac::{Hmac, Mac};
use sha2::Sha256;

use super::*;

type HmacSha256 = Hmac<Sha256>;

/// Builds a genuinely Telegram-signed `initData` string, the same way the
/// real telegram crate's own tests do — exercising the actual HMAC
/// algorithm rather than a stand-in.
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
        urlencoding_minimal(user_json)
    )
}

fn urlencoding_minimal(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}

#[test]
fn identity_persists_across_reloads() {
    let dir = tempfile::tempdir().unwrap();
    let a = load_or_create_identity(dir.path()).unwrap();
    let b = load_or_create_identity(dir.path()).unwrap();
    assert_eq!(
        a.0, b.0,
        "reloading must return the same identity, not a fresh one"
    );
}

#[test]
fn different_vaults_get_different_identities() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let a = load_or_create_identity(dir_a.path()).unwrap();
    let b = load_or_create_identity(dir_b.path()).unwrap();
    assert_ne!(a.0, b.0);
}

#[test]
fn a_correct_token_and_valid_init_data_completes_the_link() {
    let identity = SyncIdentity::generate();
    let pending = generate_linking_token();
    let init_data = build_init_data(
        "123:BOT-token",
        r#"{"id":777,"first_name":"Ann","username":"ann_t"}"#,
        now(),
    );

    let result = complete_link(
        &pending,
        &pending.token,
        &init_data,
        "123:BOT-token",
        &identity,
    )
    .unwrap();
    assert_eq!(result.telegram_user_id, 777);
    assert_eq!(result.telegram_username.as_deref(), Some("ann_t"));
    assert_eq!(result.sync_identity_hex, hex::encode(identity.0));
}

#[test]
fn a_wrong_token_is_rejected_even_with_valid_init_data() {
    let identity = SyncIdentity::generate();
    let pending = generate_linking_token();
    let init_data = build_init_data("123:BOT-token", r#"{"id":777,"first_name":"Ann"}"#, now());

    let err = complete_link(
        &pending,
        "WRONGCODE",
        &init_data,
        "123:BOT-token",
        &identity,
    )
    .unwrap_err();
    assert!(matches!(err, TelegramLinkError::TokenMismatch));
}

#[test]
fn an_expired_token_is_rejected_even_with_valid_init_data() {
    let identity = SyncIdentity::generate();
    let mut pending = generate_linking_token();
    pending.expires_at = now() - 10;
    let init_data = build_init_data("123:BOT-token", r#"{"id":777,"first_name":"Ann"}"#, now());

    let err = complete_link(
        &pending,
        &pending.token,
        &init_data,
        "123:BOT-token",
        &identity,
    )
    .unwrap_err();
    assert!(matches!(err, TelegramLinkError::TokenExpired));
}

#[test]
fn forged_init_data_is_rejected_even_with_the_right_token() {
    let identity = SyncIdentity::generate();
    let pending = generate_linking_token();
    // Signed with a *different* bot token than the one this vault expects —
    // exactly what an attacker without the real bot token would produce.
    let forged_init_data = build_init_data(
        "999:NOT-the-real-token",
        r#"{"id":777,"first_name":"Ann"}"#,
        now(),
    );

    let err = complete_link(
        &pending,
        &pending.token,
        &forged_init_data,
        "123:BOT-token",
        &identity,
    )
    .unwrap_err();
    assert!(matches!(err, TelegramLinkError::Verify(_)));
}

#[test]
fn the_handed_over_identity_lets_the_mini_app_derive_the_same_discovery_id() {
    let identity = SyncIdentity::generate();
    let pending = generate_linking_token();
    let init_data = build_init_data("123:BOT-token", r#"{"id":777,"first_name":"Ann"}"#, now());
    let result = complete_link(
        &pending,
        &pending.token,
        &init_data,
        "123:BOT-token",
        &identity,
    )
    .unwrap();

    let bytes = hex::decode(&result.sync_identity_hex).unwrap();
    let recovered = SyncIdentity(bytes.try_into().unwrap());
    assert_eq!(
        nodus_crypto::discovery::discovery_id(&recovered),
        nodus_crypto::discovery::discovery_id(&identity),
        "the Mini App must derive the exact same discovery id from the handed-over identity"
    );
}

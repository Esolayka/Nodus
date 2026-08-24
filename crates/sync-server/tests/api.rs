//! End-to-end tests against a real, locally bound server — the same way a
//! Nodus desktop client would talk to it, over actual HTTP, not by calling
//! handler functions directly. Every scenario the spec calls out explicitly
//! (bootstrap pairing, dedup, optimistic-concurrency conflicts, tombstoned
//! deletion, quota enforcement, garbage collection) gets its own test.

use std::sync::{Arc, Mutex};

use hmac::{Hmac, Mac};
use nodus_sync_server::{build_router, db, state::AppState};
use serde_json::{json, Value};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Builds a genuinely Telegram-signed `initData` string — the same HMAC
/// scheme Telegram's own client SDK produces — so these tests exercise the
/// real verification path rather than a stand-in.
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

    let encoded_user: String = user_json
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect();
    format!("auth_date={auth_date}&user={encoded_user}&hash={hash}")
}

struct TestServer {
    base_url: String,
    data_dir: tempfile::TempDir,
}

async fn spawn_server(max_storage_mb: Option<u64>, max_file_size_mb: Option<u64>) -> TestServer {
    spawn_server_full(max_storage_mb, max_file_size_mb, None).await
}

async fn spawn_server_with_telegram(bot_token: &str) -> TestServer {
    spawn_server_full(None, None, Some(bot_token.to_string())).await
}

async fn spawn_server_full(
    max_storage_mb: Option<u64>,
    max_file_size_mb: Option<u64>,
    telegram_bot_token: Option<String>,
) -> TestServer {
    let data_dir = tempfile::tempdir().unwrap();
    let conn = db::open(&data_dir.path().join("db.sqlite")).unwrap();
    let state = AppState {
        conn: Arc::new(Mutex::new(conn)),
        data_dir: data_dir.path().to_path_buf(),
        max_storage_bytes: max_storage_mb.map(|mb| mb * 1024 * 1024),
        max_file_size_bytes: max_file_size_mb.map(|mb| mb * 1024 * 1024),
        telegram_bot_token,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state);
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    TestServer {
        base_url: format!("http://{addr}"),
        data_dir,
    }
}

/// Registers the first device using a bootstrap code the test controls
/// directly (mirroring what the CLI prints on first launch), and returns
/// its bearer token.
async fn bootstrap_device(server: &TestServer, code: &str, name: &str) -> String {
    let conn = db::open(&server.data_dir.path().join("db.sqlite")).unwrap();
    db::set_bootstrap_code(&conn, code).unwrap();
    drop(conn);

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v1/devices/pair/complete", server.base_url))
        .json(&json!({ "code": code, "deviceName": name }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "bootstrap pairing should succeed");
    let body: Value = resp.json().await.unwrap();
    body["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn health_check_works_without_auth() {
    let server = spawn_server(None, None).await;
    let resp = reqwest::get(format!("{}/v1/health", server.base_url))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn requests_without_a_token_are_rejected() {
    let server = spawn_server(None, None).await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v1/sync/diff", server.base_url))
        .json(&json!({ "versions": {} }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn wrong_bootstrap_code_is_rejected() {
    let server = spawn_server(None, None).await;
    let conn = db::open(&server.data_dir.path().join("db.sqlite")).unwrap();
    db::set_bootstrap_code(&conn, "REALCODE").unwrap();
    drop(conn);

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v1/devices/pair/complete", server.base_url))
        .json(&json!({ "code": "WRONGCODE", "deviceName": "laptop" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn an_existing_device_can_pair_a_second_device_via_a_short_lived_code() {
    let server = spawn_server(None, None).await;
    let token_a = bootstrap_device(&server, "FIRSTCODE", "laptop").await;

    let client = reqwest::Client::new();
    let start = client
        .post(format!("{}/v1/devices/pair/start", server.base_url))
        .bearer_auth(&token_a)
        .send()
        .await
        .unwrap();
    assert_eq!(start.status(), 200);
    let start_body: Value = start.json().await.unwrap();
    let code = start_body["code"].as_str().unwrap().to_string();

    let complete = client
        .post(format!("{}/v1/devices/pair/complete", server.base_url))
        .json(&json!({ "code": code, "deviceName": "phone" }))
        .send()
        .await
        .unwrap();
    assert_eq!(complete.status(), 200);
    let complete_body: Value = complete.json().await.unwrap();
    assert!(
        complete_body["token"].as_str().unwrap() != token_a,
        "the second device gets its own token"
    );

    // The code is single-use.
    let reuse = client
        .post(format!("{}/v1/devices/pair/complete", server.base_url))
        .json(&json!({ "code": code, "deviceName": "again" }))
        .send()
        .await
        .unwrap();
    assert_eq!(reuse.status(), 401);
}

#[tokio::test]
async fn unknown_pairing_code_is_rejected_once_a_device_already_exists() {
    let server = spawn_server(None, None).await;
    let _token = bootstrap_device(&server, "FIRSTCODE", "laptop").await;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v1/devices/pair/complete", server.base_url))
        .json(&json!({ "code": "NOTREAL1", "deviceName": "intruder" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

async fn upload_chunk(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    id: &str,
    bytes: &[u8],
) -> reqwest::Response {
    client
        .put(format!("{base_url}/v1/chunks/{id}"))
        .bearer_auth(token)
        .body(bytes.to_vec())
        .send()
        .await
        .unwrap()
}

async fn put_blob(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    id: &str,
    base_version: u64,
    chunk_ids: &[&str],
) -> reqwest::Response {
    client
        .put(format!("{base_url}/v1/sync/blob/{id}"))
        .bearer_auth(token)
        .json(&json!({ "baseVersion": base_version, "chunkIds": chunk_ids, "encryptedPath": Value::Null }))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn uploading_a_chunk_then_committing_a_manifest_roundtrips_through_diff_and_download() {
    let server = spawn_server(None, None).await;
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    let chunk_id = "chunk-abc";
    let content = b"hello encrypted world";
    let up = upload_chunk(&client, &server.base_url, &token, chunk_id, content).await;
    assert_eq!(up.status(), 200);

    let commit = put_blob(&client, &server.base_url, &token, "file-1", 0, &[chunk_id]).await;
    assert_eq!(commit.status(), 200);
    let commit_body: Value = commit.json().await.unwrap();
    assert_eq!(commit_body["version"], 1);

    // A fresh client (no known versions) asks what changed.
    let diff = client
        .post(format!("{}/v1/sync/diff", server.base_url))
        .bearer_auth(&token)
        .json(&json!({ "versions": {} }))
        .send()
        .await
        .unwrap();
    let diff_body: Value = diff.json().await.unwrap();
    let changed = diff_body["changed"].as_array().unwrap();
    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0]["id"], "file-1");
    assert_eq!(changed[0]["version"], 1);
    assert_eq!(changed[0]["deleted"], false);

    // Download the chunk it points at and confirm it's exactly what was uploaded.
    let download = client
        .get(format!("{}/v1/chunks/{}", server.base_url, chunk_id))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(download.status(), 200);
    let downloaded = download.bytes().await.unwrap();
    assert_eq!(downloaded.as_ref(), content);

    // A client that already knows version 1 sees nothing new.
    let diff2 = client
        .post(format!("{}/v1/sync/diff", server.base_url))
        .bearer_auth(&token)
        .json(&json!({ "versions": { "file-1": 1 } }))
        .send()
        .await
        .unwrap();
    let diff2_body: Value = diff2.json().await.unwrap();
    assert_eq!(diff2_body["changed"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn identical_chunk_content_is_deduplicated_across_files() {
    let server = spawn_server(None, None).await;
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    let shared_content = b"shared attachment bytes";
    let shared_id = "shared-chunk";
    upload_chunk(&client, &server.base_url, &token, shared_id, shared_content).await;
    put_blob(&client, &server.base_url, &token, "file-a", 0, &[shared_id]).await;

    // A second, different file references the exact same chunk id (as it
    // would if both files' plaintext produced the same chunk) — uploading
    // it again must succeed without double-counting storage.
    let second_upload =
        upload_chunk(&client, &server.base_url, &token, shared_id, shared_content).await;
    assert_eq!(second_upload.status(), 200);
    put_blob(&client, &server.base_url, &token, "file-b", 0, &[shared_id]).await;

    let usage = client
        .get(format!("{}/v1/storage/usage", server.base_url))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    let usage_body: Value = usage.json().await.unwrap();
    assert_eq!(usage_body["usedBytes"], shared_content.len());
}

#[tokio::test]
async fn committing_a_manifest_that_references_an_unuploaded_chunk_is_rejected() {
    let server = spawn_server(None, None).await;
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    let resp = put_blob(
        &client,
        &server.base_url,
        &token,
        "file-1",
        0,
        &["never-uploaded"],
    )
    .await;
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn updating_with_a_stale_base_version_returns_a_conflict_with_current_state() {
    let server = spawn_server(None, None).await;
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    upload_chunk(&client, &server.base_url, &token, "c1", b"version one").await;
    put_blob(&client, &server.base_url, &token, "file-1", 0, &["c1"]).await;

    // A second device also starts from version 0 (stale) and tries to write.
    upload_chunk(
        &client,
        &server.base_url,
        &token,
        "c2",
        b"version two, from someone else",
    )
    .await;
    let resp = put_blob(&client, &server.base_url, &token, "file-1", 0, &["c2"]).await;
    assert_eq!(resp.status(), 409);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["currentVersion"], 1);
    assert_eq!(body["chunkIds"].as_array().unwrap()[0], "c1");
}

#[tokio::test]
async fn deleting_a_blob_tombstones_it_so_it_does_not_resurrect_for_a_stale_client() {
    let server = spawn_server(None, None).await;
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    upload_chunk(&client, &server.base_url, &token, "c1", b"soon deleted").await;
    put_blob(&client, &server.base_url, &token, "file-1", 0, &["c1"]).await;

    let delete = client
        .delete(format!("{}/v1/sync/blob/file-1", server.base_url))
        .bearer_auth(&token)
        .json(&json!({ "baseVersion": 1 }))
        .send()
        .await
        .unwrap();
    assert_eq!(delete.status(), 200);

    // A device that only ever saw version 0 (i.e. never even knew the file
    // existed) must be told it's gone, not "nothing changed" — otherwise
    // re-uploading its stale local copy would resurrect it.
    let diff = client
        .post(format!("{}/v1/sync/diff", server.base_url))
        .bearer_auth(&token)
        .json(&json!({ "versions": {} }))
        .send()
        .await
        .unwrap();
    let diff_body: Value = diff.json().await.unwrap();
    let changed = diff_body["changed"].as_array().unwrap();
    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0]["deleted"], true);
}

#[tokio::test]
async fn deleting_with_a_stale_base_version_is_a_conflict_not_a_silent_delete() {
    let server = spawn_server(None, None).await;
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    upload_chunk(&client, &server.base_url, &token, "c1", b"v1").await;
    put_blob(&client, &server.base_url, &token, "file-1", 0, &["c1"]).await;
    upload_chunk(
        &client,
        &server.base_url,
        &token,
        "c2",
        b"v2, edited by someone else",
    )
    .await;
    put_blob(&client, &server.base_url, &token, "file-1", 1, &["c2"]).await; // now version 2

    let delete = client
        .delete(format!("{}/v1/sync/blob/file-1", server.base_url))
        .bearer_auth(&token)
        .json(&json!({ "baseVersion": 1 })) // stale — someone else's edit landed first
        .send()
        .await
        .unwrap();
    assert_eq!(delete.status(), 409);
}

#[tokio::test]
async fn oversized_chunk_upload_is_rejected_with_a_clear_error() {
    let server = spawn_server(None, Some(0)).await; // max_file_size_mb = 0 bytes effectively
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    let resp = upload_chunk(
        &client,
        &server.base_url,
        &token,
        "big",
        b"even one byte is too many",
    )
    .await;
    assert_eq!(resp.status(), 413);
}

#[tokio::test]
async fn storage_quota_exceeded_is_rejected_with_a_clear_error() {
    let server = spawn_server(Some(0), None).await; // 0 MB quota
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    let resp = upload_chunk(&client, &server.base_url, &token, "c1", b"anything at all").await;
    assert_eq!(resp.status(), 507);
}

#[tokio::test]
async fn garbage_collection_removes_chunks_no_manifest_references_after_the_grace_period() {
    let server = spawn_server(None, None).await;
    let token = bootstrap_device(&server, "CODE1", "laptop").await;
    let client = reqwest::Client::new();

    upload_chunk(
        &client,
        &server.base_url,
        &token,
        "old-chunk",
        b"replaced content",
    )
    .await;
    put_blob(
        &client,
        &server.base_url,
        &token,
        "file-1",
        0,
        &["old-chunk"],
    )
    .await;

    upload_chunk(
        &client,
        &server.base_url,
        &token,
        "new-chunk",
        b"edited content",
    )
    .await;
    put_blob(
        &client,
        &server.base_url,
        &token,
        "file-1",
        1,
        &["new-chunk"],
    )
    .await; // "old-chunk" is now orphaned

    let conn = db::open(&server.data_dir.path().join("db.sqlite")).unwrap();
    // Backdate the orphaned chunk past the grace period instead of sleeping
    // for real in a test.
    conn.execute(
        "UPDATE chunks SET created_at = created_at - 100000 WHERE id = 'old-chunk'",
        [],
    )
    .unwrap();
    let removed = nodus_sync_server::gc::run_gc_once(&conn, server.data_dir.path()).unwrap();
    assert_eq!(removed, 1);

    let still_there: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM chunks WHERE id = 'old-chunk')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!still_there);

    // The chunk still in use must survive the same GC pass untouched.
    let survivor: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM chunks WHERE id = 'new-chunk')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(survivor);
}

#[tokio::test]
async fn discovery_announce_and_resolve_roundtrip_without_auth() {
    let server = spawn_server(None, None).await;
    let client = reqwest::Client::new();

    // No bearer token at all — local mode must work for a device with no
    // Nodus-server account whatsoever.
    let announce = client
        .post(format!("{}/v1/discovery/announce", server.base_url))
        .json(&json!({ "discoveryId": "opaque-id-1", "encryptedAddress": "ciphertext-blob" }))
        .send()
        .await
        .unwrap();
    assert_eq!(announce.status(), 200);

    let resolve = client
        .get(format!(
            "{}/v1/discovery/resolve/opaque-id-1",
            server.base_url
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resolve.status(), 200);
    let body: Value = resolve.json().await.unwrap();
    assert_eq!(body["encryptedAddress"], "ciphertext-blob");
    assert_eq!(body["stale"], false);
}

#[tokio::test]
async fn discovery_resolve_for_an_unknown_id_is_not_found() {
    let server = spawn_server(None, None).await;
    let resp = reqwest::get(format!(
        "{}/v1/discovery/resolve/never-announced",
        server.base_url
    ))
    .await
    .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn a_stale_announcement_still_resolves_but_is_marked_stale() {
    let server = spawn_server(None, None).await;
    let client = reqwest::Client::new();
    client
        .post(format!("{}/v1/discovery/announce", server.base_url))
        .json(&json!({ "discoveryId": "opaque-id-2", "encryptedAddress": "ciphertext-blob" }))
        .send()
        .await
        .unwrap();

    let conn = db::open(&server.data_dir.path().join("db.sqlite")).unwrap();
    conn.execute("UPDATE announcements SET expires_at = expires_at - 100000 WHERE discovery_id = 'opaque-id-2'", [])
        .unwrap();

    let resolve = reqwest::get(format!(
        "{}/v1/discovery/resolve/opaque-id-2",
        server.base_url
    ))
    .await
    .unwrap();
    assert_eq!(resolve.status(), 200);
    let body: Value = resolve.json().await.unwrap();
    // Still returns the last known (encrypted) address and when it was last
    // seen — a "computer unavailable, last seen at ..." screen needs this,
    // not a bare 404.
    assert_eq!(body["encryptedAddress"], "ciphertext-blob");
    assert_eq!(body["stale"], true);
}

#[tokio::test]
async fn a_genuinely_signed_telegram_init_data_registers_a_device() {
    let server = spawn_server_with_telegram("123:BOT-token").await;
    let client = reqwest::Client::new();
    let init_data = build_init_data(
        "123:BOT-token",
        r#"{"id":777,"first_name":"Ann"}"#,
        db::now(),
    );

    let resp = client
        .post(format!("{}/v1/devices/pair/telegram", server.base_url))
        .json(&json!({ "initData": init_data, "deviceName": "telegram-mini-app" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let token = body["token"].as_str().unwrap().to_string();

    // The issued token behaves exactly like any other device token.
    let diff = client
        .post(format!("{}/v1/sync/diff", server.base_url))
        .bearer_auth(&token)
        .json(&json!({ "versions": {} }))
        .send()
        .await
        .unwrap();
    assert_eq!(diff.status(), 200);
}

#[tokio::test]
async fn telegram_registration_is_rejected_when_the_server_has_no_bot_token_configured() {
    let server = spawn_server(None, None).await; // no telegram_bot_token
    let client = reqwest::Client::new();
    let init_data = build_init_data(
        "123:BOT-token",
        r#"{"id":777,"first_name":"Ann"}"#,
        db::now(),
    );

    let resp = client
        .post(format!("{}/v1/devices/pair/telegram", server.base_url))
        .json(&json!({ "initData": init_data, "deviceName": "telegram-mini-app" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn telegram_registration_rejects_init_data_signed_with_the_wrong_bot_token() {
    let server = spawn_server_with_telegram("123:BOT-token").await;
    let client = reqwest::Client::new();
    let forged = build_init_data(
        "999:NOT-the-real-token",
        r#"{"id":777,"first_name":"Ann"}"#,
        db::now(),
    );

    let resp = client
        .post(format!("{}/v1/devices/pair/telegram", server.base_url))
        .json(&json!({ "initData": forged, "deviceName": "telegram-mini-app" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn an_oversized_announced_address_is_rejected() {
    let server = spawn_server(None, None).await;
    let client = reqwest::Client::new();
    let huge = "x".repeat(10_000);
    let resp = client
        .post(format!("{}/v1/discovery/announce", server.base_url))
        .json(&json!({ "discoveryId": "opaque-id-3", "encryptedAddress": huge }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

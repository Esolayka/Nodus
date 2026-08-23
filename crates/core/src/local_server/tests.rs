//! Exercised over real HTTP against a locally bound server, the same way
//! the Mini App (through a tunnel) or a curl-based smoke check would reach
//! it — not by calling the handler functions directly.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use hmac::{Hmac, Mac};
use sha2::Sha256;

use super::*;
use crate::history::HistorySettings;
use crate::telegram_link;

type HmacSha256 = Hmac<Sha256>;

fn build_init_data(bot_token: &str, user_json: &str, auth_date: i64) -> String {
    let mut pairs = vec![("auth_date".to_string(), auth_date.to_string()), ("user".to_string(), user_json.to_string())];
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    let data_check_string = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");

    let mut secret_mac = HmacSha256::new_from_slice(b"WebAppData").unwrap();
    secret_mac.update(bot_token.as_bytes());
    let secret_key = secret_mac.finalize().into_bytes();
    let mut data_mac = HmacSha256::new_from_slice(&secret_key).unwrap();
    data_mac.update(data_check_string.as_bytes());
    let hash = hex::encode(data_mac.finalize().into_bytes());

    let encoded_user: String =
        user_json.chars().map(|c| if c.is_alphanumeric() { c.to_string() } else { format!("%{:02X}", c as u32) }).collect();
    format!("auth_date={auth_date}&user={encoded_user}&hash={hash}")
}

struct TestServer {
    base_url: String,
    state: LocalServerState,
    // Kept alive for the vault-backed tests' lifetime.
    _vault_dir: Option<tempfile::TempDir>,
}

fn spawn_server(bot_token: Option<&str>) -> TestServer {
    spawn_server_with_vault(bot_token, false)
}

fn spawn_server_with_vault(bot_token: Option<&str>, with_vault: bool) -> TestServer {
    let (vault_service, vault_dir) = if with_vault {
        let dir = tempfile::tempdir().unwrap();
        let service = VaultService::open(dir.path(), HistorySettings::default(), |_| {}).unwrap();
        (Some(service), Some(dir))
    } else {
        (None, None)
    };

    let state = LocalServerState {
        bot_token: Arc::new(Mutex::new(bot_token.map(String::from))),
        pending_link: Arc::new(Mutex::new(None)),
        identity: Arc::new(Mutex::new(Some(SyncIdentity::generate()))),
        session_tokens: Arc::new(Mutex::new(HashSet::new())),
        vault_service: Arc::new(Mutex::new(vault_service)),
    };
    let state_for_server = state.clone();

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tx.send(addr).unwrap();
            axum::serve(listener, build_router(state_for_server, None)).await.unwrap();
        });
    });
    let addr = rx.recv().unwrap();
    TestServer { base_url: format!("http://{addr}"), state, _vault_dir: vault_dir }
}

/// Drives a real linking handshake against the running server and returns
/// the session token it hands back — the same thing the Mini App would
/// hold onto for every subsequent request.
fn link_and_get_session_token(server: &TestServer, bot_token: &str) -> String {
    let pending = telegram_link::generate_linking_token();
    *server.state.pending_link.lock().unwrap() = Some(pending.clone());
    let init_data = build_init_data(bot_token, r#"{"id":555,"first_name":"Bob"}"#, telegram_link::now());

    let resp = reqwest::blocking::Client::new()
        .post(format!("{}/telegram/link", server.base_url))
        .json(&serde_json::json!({ "token": pending.token, "initData": init_data }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().unwrap();
    body["sessionToken"].as_str().unwrap().to_string()
}

#[test]
fn health_check_works() {
    let server = spawn_server(None);
    let resp = reqwest::blocking::get(format!("{}/health", server.base_url)).unwrap();
    assert_eq!(resp.status(), 200);
}

#[test]
fn a_correct_token_and_genuinely_signed_init_data_completes_the_link() {
    let server = spawn_server(Some("123:BOT-token"));
    let pending = telegram_link::generate_linking_token();
    *server.state.pending_link.lock().unwrap() = Some(pending.clone());
    let init_data = build_init_data("123:BOT-token", r#"{"id":555,"first_name":"Bob"}"#, telegram_link::now());

    let resp = reqwest::blocking::Client::new()
        .post(format!("{}/telegram/link", server.base_url))
        .json(&serde_json::json!({ "token": pending.token, "initData": init_data }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().unwrap();
    assert_eq!(body["telegramUserId"], 555);
    assert!(body["syncIdentityHex"].as_str().unwrap().len() == 64);
    assert!(!body["sessionToken"].as_str().unwrap().is_empty());
}

#[test]
fn the_same_linking_code_cannot_be_redeemed_twice() {
    let server = spawn_server(Some("123:BOT-token"));
    let pending = telegram_link::generate_linking_token();
    *server.state.pending_link.lock().unwrap() = Some(pending.clone());
    let init_data = build_init_data("123:BOT-token", r#"{"id":555,"first_name":"Bob"}"#, telegram_link::now());

    let client = reqwest::blocking::Client::new();
    let first =
        client.post(format!("{}/telegram/link", server.base_url)).json(&serde_json::json!({ "token": pending.token, "initData": init_data })).send().unwrap();
    assert_eq!(first.status(), 200);

    let second =
        client.post(format!("{}/telegram/link", server.base_url)).json(&serde_json::json!({ "token": pending.token, "initData": init_data })).send().unwrap();
    assert_eq!(second.status(), 400);
}

#[test]
fn linking_without_a_generated_code_is_rejected() {
    let server = spawn_server(Some("123:BOT-token"));
    let init_data = build_init_data("123:BOT-token", r#"{"id":555,"first_name":"Bob"}"#, telegram_link::now());

    let resp = reqwest::blocking::Client::new()
        .post(format!("{}/telegram/link", server.base_url))
        .json(&serde_json::json!({ "token": "ANYCODE1", "initData": init_data }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[test]
fn linking_without_a_configured_bot_token_is_rejected() {
    let server = spawn_server(None);
    let pending = telegram_link::generate_linking_token();
    *server.state.pending_link.lock().unwrap() = Some(pending.clone());
    let init_data = build_init_data("123:BOT-token", r#"{"id":555,"first_name":"Bob"}"#, telegram_link::now());

    let resp = reqwest::blocking::Client::new()
        .post(format!("{}/telegram/link", server.base_url))
        .json(&serde_json::json!({ "token": pending.token, "initData": init_data }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[test]
fn linking_with_no_vault_open_is_rejected() {
    let server = spawn_server(Some("123:BOT-token"));
    *server.state.identity.lock().unwrap() = None; // no vault open
    let pending = telegram_link::generate_linking_token();
    *server.state.pending_link.lock().unwrap() = Some(pending.clone());
    let init_data = build_init_data("123:BOT-token", r#"{"id":555,"first_name":"Bob"}"#, telegram_link::now());

    let resp = reqwest::blocking::Client::new()
        .post(format!("{}/telegram/link", server.base_url))
        .json(&serde_json::json!({ "token": pending.token, "initData": init_data }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[test]
fn linking_with_the_wrong_code_is_rejected() {
    let server = spawn_server(Some("123:BOT-token"));
    let pending = telegram_link::generate_linking_token();
    *server.state.pending_link.lock().unwrap() = Some(pending);
    let init_data = build_init_data("123:BOT-token", r#"{"id":555,"first_name":"Bob"}"#, telegram_link::now());

    let resp = reqwest::blocking::Client::new()
        .post(format!("{}/telegram/link", server.base_url))
        .json(&serde_json::json!({ "token": "WRONGCODE", "initData": init_data }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[test]
fn vault_routes_reject_requests_with_no_session_token() {
    let server = spawn_server_with_vault(Some("123:BOT-token"), true);
    let resp = reqwest::blocking::get(format!("{}/vault/tree", server.base_url)).unwrap();
    assert_eq!(resp.status(), 401);
}

#[test]
fn a_linked_session_can_write_and_read_back_a_note() {
    let server = spawn_server_with_vault(Some("123:BOT-token"), true);
    let token = link_and_get_session_token(&server, "123:BOT-token");
    let client = reqwest::blocking::Client::new();

    let write = client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "Idea.md", "content": "written from the Mini App" }))
        .send()
        .unwrap();
    assert_eq!(write.status(), 200);

    let read = client.get(format!("{}/vault/note?path=Idea.md", server.base_url)).bearer_auth(&token).send().unwrap();
    assert_eq!(read.status(), 200);
    let body: serde_json::Value = read.json().unwrap();
    assert_eq!(body["content"], "written from the Mini App");

    let tree = client.get(format!("{}/vault/tree", server.base_url)).bearer_auth(&token).send().unwrap();
    assert_eq!(tree.status(), 200);
    let tree_body: serde_json::Value = tree.json().unwrap();
    assert!(tree_body["children"].as_array().unwrap().iter().any(|n| n["name"] == "Idea.md"));
}

#[test]
fn a_write_based_on_a_stale_hash_is_rejected_as_a_conflict_with_the_current_content() {
    let server = spawn_server_with_vault(Some("123:BOT-token"), true);
    let token = link_and_get_session_token(&server, "123:BOT-token");
    let client = reqwest::blocking::Client::new();

    // First write: brand new note, no base hash expected.
    let first = client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "Shared.md", "content": "version one" }))
        .send()
        .unwrap();
    assert_eq!(first.status(), 200);

    // Simulate someone else's edit landing in between: a second write with
    // the correct (now-current) hash succeeds and moves the note forward.
    let first_hash: serde_json::Value = first.json().unwrap();
    let second = client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "Shared.md", "content": "version two", "baseHash": first_hash["hash"] }))
        .send()
        .unwrap();
    assert_eq!(second.status(), 200);

    // A queued offline write still carrying the *original* (now stale)
    // hash must be rejected, not silently clobber "version two".
    let stale = client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "Shared.md", "content": "offline edit", "baseHash": first_hash["hash"] }))
        .send()
        .unwrap();
    assert_eq!(stale.status(), 409);
    let conflict_body: serde_json::Value = stale.json().unwrap();
    assert_eq!(conflict_body["currentContent"], "version two");

    // "version two" must still be there, untouched.
    let read =
        client.get(format!("{}/vault/note?path=Shared.md", server.base_url)).bearer_auth(&token).send().unwrap();
    let read_body: serde_json::Value = read.json().unwrap();
    assert_eq!(read_body["content"], "version two");
}

#[test]
fn writing_a_supposedly_new_note_that_already_exists_is_a_conflict() {
    let server = spawn_server_with_vault(Some("123:BOT-token"), true);
    let token = link_and_get_session_token(&server, "123:BOT-token");
    let client = reqwest::blocking::Client::new();

    client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "New.md", "content": "created on the desktop" }))
        .send()
        .unwrap();

    // The phone independently created a note at the same path, offline,
    // believing it was new (no base hash) — it must not silently clobber
    // the desktop's version once it reconnects.
    let resp = client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "New.md", "content": "created on the phone" }))
        .send()
        .unwrap();
    assert_eq!(resp.status(), 409);
    let body: serde_json::Value = resp.json().unwrap();
    assert_eq!(body["currentContent"], "created on the desktop");
}

#[test]
fn search_and_tags_reflect_a_note_written_through_the_api() {
    let server = spawn_server_with_vault(Some("123:BOT-token"), true);
    let token = link_and_get_session_token(&server, "123:BOT-token");
    let client = reqwest::blocking::Client::new();

    client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "Tagged.md", "content": "a note about #cooking" }))
        .send()
        .unwrap();

    let search =
        client.get(format!("{}/vault/search?q=cooking", server.base_url)).bearer_auth(&token).send().unwrap();
    let search_body: serde_json::Value = search.json().unwrap();
    assert_eq!(search_body.as_array().unwrap().len(), 1);

    let tags = client.get(format!("{}/vault/tags", server.base_url)).bearer_auth(&token).send().unwrap();
    let tags_body: serde_json::Value = tags.json().unwrap();
    assert!(tags_body.as_array().unwrap().iter().any(|t| t["tag"] == "cooking"));
}

#[test]
fn a_task_can_be_listed_and_toggled_through_the_api() {
    let server = spawn_server_with_vault(Some("123:BOT-token"), true);
    let token = link_and_get_session_token(&server, "123:BOT-token");
    let client = reqwest::blocking::Client::new();

    client
        .put(format!("{}/vault/note", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "Tasks.md", "content": "- [ ] buy milk\n" }))
        .send()
        .unwrap();

    let tasks = client.get(format!("{}/vault/tasks", server.base_url)).bearer_auth(&token).send().unwrap();
    let tasks_body: serde_json::Value = tasks.json().unwrap();
    let task = &tasks_body.as_array().unwrap()[0];
    assert_eq!(task["done"], false);

    let toggle = client
        .put(format!("{}/vault/tasks/toggle", server.base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "path": "Tasks.md",
            "markerStart": task["markerStart"],
            "markerEnd": task["markerEnd"],
            "expectedMarker": "[ ]",
            "addCompletionDate": false,
        }))
        .send()
        .unwrap();
    assert_eq!(toggle.status(), 200);

    let read = client.get(format!("{}/vault/note?path=Tasks.md", server.base_url)).bearer_auth(&token).send().unwrap();
    let body: serde_json::Value = read.json().unwrap();
    assert!(body["content"].as_str().unwrap().contains("[x]"));
}

#[test]
fn an_image_attachment_is_served_with_the_right_content_type() {
    let server = spawn_server_with_vault(Some("123:BOT-token"), true);
    let token = link_and_get_session_token(&server, "123:BOT-token");

    {
        let guard = server.state.vault_service.lock().unwrap();
        let service = guard.as_ref().unwrap();
        std::fs::write(service.root().join("photo.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
    }

    let resp = reqwest::blocking::Client::new()
        .get(format!("{}/vault/attachment?path=photo.png", server.base_url))
        .bearer_auth(&token)
        .send()
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.headers().get("content-type").unwrap(), "image/png");
    assert_eq!(resp.bytes().unwrap().as_ref(), &[0x89, 0x50, 0x4e, 0x47]);
}

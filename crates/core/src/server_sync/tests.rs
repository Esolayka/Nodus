//! Integration tests against a *real* `nodus-sync-server`, spun up in a
//! background thread with its own tiny Tokio runtime — mirroring how
//! `git_sync`'s tests use a real bare repository as a stand-in remote
//! instead of mocking anything. Two independent `ServerSync` instances,
//! each with its own vault directory and local tracking database, stand in
//! for two devices sharing one server.

use std::path::Path;
use std::sync::{Arc, Mutex};

use nodus_crypto::Dek;
use nodus_sync_server::{build_router, db as server_db, state::AppState};

use super::*;
use crate::vault::Vault;

struct TestServer {
    base_url: String,
    _data_dir: tempfile::TempDir,
}

fn spawn_server() -> TestServer {
    let data_dir = tempfile::tempdir().unwrap();
    let db_path = data_dir.path().join("db.sqlite");
    let conn = server_db::open(&db_path).unwrap();
    let state = AppState {
        conn: Arc::new(Mutex::new(conn)),
        data_dir: data_dir.path().to_path_buf(),
        max_storage_bytes: None,
        max_file_size_bytes: None,
        telegram_bot_token: None,
    };

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tx.send(addr).unwrap();
            axum::serve(listener, build_router(state)).await.unwrap();
        });
    });
    let addr = rx.recv().unwrap();
    TestServer { base_url: format!("http://{addr}"), _data_dir: data_dir }
}

fn bootstrap_token(server: &TestServer, name: &str) -> String {
    let conn = server_db::open(&server._data_dir.path().join("db.sqlite")).unwrap();
    server_db::set_bootstrap_code(&conn, "TESTCODE").unwrap();
    drop(conn);
    let resp = ServerSyncClient::pair_complete(&server.base_url, "TESTCODE", name).unwrap();
    resp.token
}

fn open_device(server: &TestServer, token: &str, dek: Option<Dek>, device_name: &str) -> (tempfile::TempDir, ServerSync) {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    let sync = ServerSync::open(vault, server.base_url.clone(), token.to_string(), dek, device_name).unwrap();
    (dir, sync)
}

fn write(dir: &Path, path: &str, content: &str) {
    let full = dir.join(path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(full, content).unwrap();
}

fn read(dir: &Path, path: &str) -> String {
    std::fs::read_to_string(dir.join(path)).unwrap()
}

#[test]
fn a_note_created_on_one_device_appears_on_another_after_both_sync() {
    let server = spawn_server();
    let token_a = bootstrap_token(&server, "laptop");
    let (dir_a, mut a) = open_device(&server, &token_a, None, "laptop");
    let (dir_b, mut b) = open_device(&server, &token_a, None, "phone");

    write(dir_a.path(), "Idea.md", "a new idea");
    let report = a.sync_once().unwrap();
    assert_eq!(report.uploaded, vec!["Idea.md".to_string()]);

    let report = b.sync_once().unwrap();
    assert_eq!(report.downloaded, vec!["Idea.md".to_string()]);
    assert_eq!(read(dir_b.path(), "Idea.md"), "a new idea");
}

#[test]
fn an_edit_on_one_device_reaches_the_other_after_both_have_already_synced_once() {
    let server = spawn_server();
    let token = bootstrap_token(&server, "laptop");
    let (dir_a, mut a) = open_device(&server, &token, None, "laptop");
    let (dir_b, mut b) = open_device(&server, &token, None, "phone");

    write(dir_a.path(), "Note.md", "v1");
    a.sync_once().unwrap();
    b.sync_once().unwrap();
    assert_eq!(read(dir_b.path(), "Note.md"), "v1");

    write(dir_a.path(), "Note.md", "v2");
    a.sync_once().unwrap();
    b.sync_once().unwrap();
    assert_eq!(read(dir_b.path(), "Note.md"), "v2");
}

#[test]
fn deleting_on_one_device_removes_it_on_the_other_and_it_does_not_resurrect() {
    let server = spawn_server();
    let token = bootstrap_token(&server, "laptop");
    let (dir_a, mut a) = open_device(&server, &token, None, "laptop");
    let (dir_b, mut b) = open_device(&server, &token, None, "phone");

    write(dir_a.path(), "Temp.md", "temporary");
    a.sync_once().unwrap();
    b.sync_once().unwrap();
    assert!(dir_b.path().join("Temp.md").exists());

    std::fs::remove_file(dir_a.path().join("Temp.md")).unwrap();
    let report = a.sync_once().unwrap();
    assert_eq!(report.deleted_remotely, vec!["Temp.md".to_string()]);

    let report = b.sync_once().unwrap();
    assert_eq!(report.deleted_locally, vec!["Temp.md".to_string()]);
    assert!(!dir_b.path().join("Temp.md").exists());

    // A third, previously-offline device that never even saw the file
    // exist must also just end up without it, not resurrect it.
    let (dir_c, mut c) = open_device(&server, &token, None, "tablet");
    c.sync_once().unwrap();
    assert!(!dir_c.path().join("Temp.md").exists());
}

#[test]
fn non_overlapping_edits_on_both_devices_merge_automatically() {
    let server = spawn_server();
    let token = bootstrap_token(&server, "laptop");
    let (dir_a, mut a) = open_device(&server, &token, None, "laptop");
    let (dir_b, mut b) = open_device(&server, &token, None, "phone");

    write(dir_a.path(), "Log.md", "line one\nline two\nline three\n");
    a.sync_once().unwrap();
    b.sync_once().unwrap();

    // Both start from the same synced content and edit different lines.
    write(dir_a.path(), "Log.md", "line one EDITED\nline two\nline three\n");
    write(dir_b.path(), "Log.md", "line one\nline two\nline three EDITED\n");

    a.sync_once().unwrap();
    let report = b.sync_once().unwrap();

    assert!(report.conflicts.contains(&"Log.md".to_string()), "should be flagged as a resolved conflict");
    let merged = read(dir_b.path(), "Log.md");
    assert!(merged.contains("line one EDITED"));
    assert!(merged.contains("line three EDITED"));
    assert!(!merged.contains("<<<<<<<"), "raw conflict markers must never reach the note");

    // b's merge result must itself propagate back to a.
    b.sync_once().unwrap();
    a.sync_once().unwrap();
    assert_eq!(read(dir_a.path(), "Log.md"), merged);
}

#[test]
fn conflicting_edits_to_the_same_line_keep_both_versions_instead_of_discarding_either() {
    let server = spawn_server();
    let token = bootstrap_token(&server, "laptop");
    let (dir_a, mut a) = open_device(&server, &token, None, "laptop");
    let (dir_b, mut b) = open_device(&server, &token, None, "phone");

    write(dir_a.path(), "Same.md", "original line\n");
    a.sync_once().unwrap();
    b.sync_once().unwrap();

    write(dir_a.path(), "Same.md", "device A's version\n");
    write(dir_b.path(), "Same.md", "device B's version\n");

    a.sync_once().unwrap();
    let report = b.sync_once().unwrap();

    assert!(report.conflicts.contains(&"Same.md".to_string()));
    // The main path becomes the canonical (remote) version, matching what
    // every other device already has...
    assert_eq!(read(dir_b.path(), "Same.md"), "device A's version\n");
    // ...and b's own edit is preserved as a sibling copy, never silently
    // discarded, labeled with b's own device name.
    let entries: Vec<_> =
        std::fs::read_dir(dir_b.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    let sibling = entries.iter().find(|n| n.starts_with("Same (") && n.contains("phone") && n.ends_with(".md")).cloned();
    assert!(sibling.is_some(), "expected a (device, date)-suffixed sibling copy, got: {entries:?}");
    assert_eq!(read(dir_b.path(), sibling.as_ref().unwrap()), "device B's version\n");

    // That sibling is a brand new file to b's push phase, so it should
    // already have synced to the server in this same sync_once() call —
    // a third device must see both the canonical file and the sibling.
    let (dir_c, mut c) = open_device(&server, &token, None, "tablet");
    c.sync_once().unwrap();
    assert_eq!(read(dir_c.path(), "Same.md"), "device A's version\n");
    assert_eq!(read(dir_c.path(), sibling.as_ref().unwrap()), "device B's version\n");
}

#[test]
fn an_encrypted_vault_stores_only_ciphertext_and_a_hidden_filename_on_the_server() {
    let server = spawn_server();
    let token = bootstrap_token(&server, "laptop");
    let dek = Dek::generate();
    let (dir_a, mut a) = open_device(&server, &token, Some(dek.clone()), "laptop");

    write(dir_a.path(), "Secret Diary.md", "the actual secret content");
    a.sync_once().unwrap();

    // Pull every raw chunk straight out of the server's own storage, the way
    // an operator with shell access to the container would — chunk ids are
    // content-derived, not path-derived, so just walk the whole store
    // rather than trying to predict a single filename.
    let chunks_root = server._data_dir.path().join("chunks");
    let mut raw_chunks = Vec::new();
    for prefix_dir in std::fs::read_dir(&chunks_root).unwrap() {
        let prefix_dir = prefix_dir.unwrap().path();
        for file in std::fs::read_dir(&prefix_dir).unwrap() {
            raw_chunks.push(std::fs::read(file.unwrap().path()).unwrap());
        }
    }
    assert!(!raw_chunks.is_empty(), "at least one chunk file must exist on disk");
    for raw_chunk in &raw_chunks {
        let raw_text = String::from_utf8_lossy(raw_chunk);
        assert!(!raw_text.contains("secret"), "raw server storage must not contain the plaintext");
        assert!(!raw_text.to_lowercase().contains("diary"), "raw server storage must not reveal the filename");
    }
    // The blob id itself (the server's key for this file's metadata row)
    // must not reveal the filename either.
    let blob_id = nodus_crypto::paths::blob_id_for_path(&dek, "Secret Diary.md");
    assert!(!blob_id.to_lowercase().contains("diary"));

    // A second device with the *same* key can still decrypt everything.
    let (dir_b, mut b) = open_device(&server, &token, Some(dek), "phone");
    b.sync_once().unwrap();
    assert_eq!(read(dir_b.path(), "Secret Diary.md"), "the actual secret content");
}

#[test]
fn a_ten_thousand_note_vaults_incremental_sync_only_uploads_what_changed() {
    let server = spawn_server();
    let token = bootstrap_token(&server, "laptop");
    let (dir_a, mut a) = open_device(&server, &token, None, "laptop");

    // A scaled-down stand-in for "10,000 notes": what matters for this test
    // is the *shape* of the behavior (first sync uploads everything,
    // second sync uploads only the one changed file), not the literal
    // count, which would make the test suite slow for no added coverage.
    for i in 0..50 {
        write(dir_a.path(), &format!("Note{i}.md"), &format!("content {i}"));
    }
    let first = a.sync_once().unwrap();
    assert_eq!(first.uploaded.len(), 50);

    write(dir_a.path(), "Note7.md", "content 7, edited");
    let second = a.sync_once().unwrap();
    assert_eq!(second.uploaded, vec!["Note7.md".to_string()]);
}

//! Syncing a vault against a `nodus-sync-server`: chunking file content
//! (encrypted, via `nodus-crypto`, when the vault has encryption on; plain
//! content-addressed chunks otherwise), pushing/pulling only what changed,
//! and resolving conflicts the same way the spec requires everywhere else
//! in this project — attempt an automatic line-based merge, and if that
//! doesn't fully resolve, keep *both* versions rather than picking one.
//!
//! The chunking split deliberately happens *before* any encryption
//! decision: [`chunk_content`] and [`blob_id_for_path`] both branch on
//! whether a [`Dek`] is available, so the exact same sync engine serves
//! encrypted and unencrypted vaults without duplicating the push/pull
//! logic itself.

pub mod client;
pub mod db;
pub mod error;
#[cfg(test)]
mod tests;

use std::path::PathBuf;

use nodus_crypto::Dek;
use sha2::{Digest, Sha256};

pub use client::{ChangedFile, PutOutcome, ServerSyncClient};
pub use error::{Result, ServerSyncError};

use crate::vault::Vault;

#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub uploaded: Vec<String>,
    pub downloaded: Vec<String>,
    /// Removed from local disk because the server said they were deleted
    /// elsewhere.
    pub deleted_locally: Vec<String>,
    /// Reported to the server as deleted because they vanished from local
    /// disk since the last sync.
    pub deleted_remotely: Vec<String>,
    /// Paths where a conflict was found — either merged automatically (still
    /// worth surfacing so the user knows it happened) or resolved by
    /// creating a `(device, date)`-suffixed sibling copy.
    pub conflicts: Vec<String>,
}

pub struct ServerSync {
    client: ServerSyncClient,
    vault: Vault,
    db: rusqlite::Connection,
    dek: Option<Dek>,
    device_name: String,
}

fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Splits `plaintext` into the same fixed-size pieces as the encrypted path
/// (so a vault can switch encryption on/off without changing the shape of
/// its sync protocol), addressed by a bare content hash since there's no
/// key to keep the id from being a plain fingerprint — an accepted tradeoff
/// of leaving encryption off in the first place.
fn plain_chunks(plaintext: &[u8]) -> Vec<(String, Vec<u8>)> {
    let hash_piece = |piece: &[u8]| content_hash(piece);
    if plaintext.is_empty() {
        return vec![(hash_piece(&[]), Vec::new())];
    }
    plaintext
        .chunks(nodus_crypto::chunk::CHUNK_SIZE)
        .map(|p| (hash_piece(p), p.to_vec()))
        .collect()
}

fn chunk_content(dek: Option<&Dek>, plaintext: &[u8]) -> Vec<(String, Vec<u8>)> {
    match dek {
        Some(dek) => nodus_crypto::chunk::split_and_encrypt(dek, plaintext)
            .into_iter()
            .map(|c| (c.id, c.ciphertext))
            .collect(),
        None => plain_chunks(plaintext),
    }
}

fn decrypt_chunk_bytes(dek: Option<&Dek>, bytes: &[u8]) -> Result<Vec<u8>> {
    match dek {
        Some(dek) => Ok(nodus_crypto::chunk::decrypt_chunk(dek, bytes)?),
        None => Ok(bytes.to_vec()),
    }
}

fn blob_id_for_path(dek: Option<&Dek>, path: &str) -> String {
    match dek {
        Some(dek) => nodus_crypto::paths::blob_id_for_path(dek, path),
        None => content_hash(path.as_bytes()),
    }
}

/// What actually travels in a blob's `encryptedPath` field — genuinely
/// encrypted when the vault has a key, and just the plain path otherwise.
/// Needed so a device that has never seen a given blob id before (a brand
/// new file created on a different device) learns what local path to write
/// the download to.
fn encode_path_metadata(dek: Option<&Dek>, path: &str) -> Option<String> {
    match dek {
        Some(dek) => Some(nodus_crypto::paths::encrypt_path(dek, path)),
        None => Some(path.to_string()),
    }
}

fn decode_path_metadata(dek: Option<&Dek>, encoded: &str) -> Result<String> {
    match dek {
        Some(dek) => Ok(nodus_crypto::paths::decrypt_path(dek, encoded)?),
        None => Ok(encoded.to_string()),
    }
}

/// `git2::merge_file` is the one public git2 entry point that never
/// triggers libgit2's own global init (every other constructor — opening a
/// repository, a config, a diff — does). Called as the very first git2
/// operation in a process, it fails with an opaque, message-less error
/// instead of merging anything. The Git sync backend never hits this
/// because it always opens a real `Repository` first as a side effect of
/// everything else it does; this engine never does, so it has to force
/// that same one-time init itself. Opening (and immediately discarding) a
/// throwaway bare repository is a harmless, well-known way to do that.
fn ensure_libgit2_initialized() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let dir = std::env::temp_dir().join(format!("nodus-git2-init-{}", std::process::id()));
        if git2::Repository::init_bare(&dir).is_ok() {
            let _ = std::fs::remove_dir_all(&dir);
        }
    });
}

/// Attempts a 3-way text merge exactly the way the Git backend does (same
/// underlying `git2::merge_file`, no repository needed) — only ever for
/// `.md` notes, never attachments, since a byte-level "merge" of a binary
/// file is meaningless. `None` means either it isn't text, or real
/// conflicting hunks remain — the caller falls back to keeping both.
fn try_merge_text(path: &str, ancestor: &[u8], mine: &[u8], theirs: &[u8]) -> Option<Vec<u8>> {
    if !path.to_lowercase().ends_with(".md") {
        return None;
    }
    ensure_libgit2_initialized();
    let mut ancestor_input = git2::MergeFileInput::new();
    ancestor_input.content(ancestor);
    let mut mine_input = git2::MergeFileInput::new();
    mine_input.content(mine);
    let mut theirs_input = git2::MergeFileInput::new();
    theirs_input.content(theirs);

    let result = git2::merge_file(&ancestor_input, &mine_input, &theirs_input, None).ok()?;
    let merged_text = String::from_utf8_lossy(result.content()).into_owned();
    let segments = crate::git_sync::conflict::parse_conflict_markers(&merged_text);
    if crate::git_sync::conflict::conflict_count(&segments) == 0 {
        Some(merged_text.into_bytes())
    } else {
        None
    }
}

fn today_string() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn sanitize_device_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "device".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Builds a non-colliding `Name (device, YYYY-MM-DD).ext` sibling path next
/// to `path`, for the "keep both" side of a conflict — the loser of the
/// name collision gets a numeric suffix too, in the rare case even the
/// suffixed name is already taken.
fn conflict_copy_path(vault: &Vault, path: &str, device_name: &str) -> Result<PathBuf> {
    let (dir, filename) = match path.rfind('/') {
        Some(idx) => (&path[..idx], &path[idx + 1..]),
        None => ("", path),
    };
    let (stem, ext) = match filename.rfind('.') {
        Some(idx) if idx > 0 => (&filename[..idx], Some(&filename[idx + 1..])),
        _ => (filename, None),
    };
    let suffix = format!("{}, {}", today_string(), sanitize_device_name(device_name));

    let candidate = |n: Option<u32>| -> String {
        let name = match (ext, n) {
            (Some(ext), None) => format!("{stem} ({suffix}).{ext}"),
            (Some(ext), Some(n)) => format!("{stem} ({suffix}) {n}.{ext}"),
            (None, None) => format!("{stem} ({suffix})"),
            (None, Some(n)) => format!("{stem} ({suffix}) {n}"),
        };
        if dir.is_empty() {
            name
        } else {
            format!("{dir}/{name}")
        }
    };

    let mut relative = candidate(None);
    let mut n = 1;
    while vault.resolve(&relative)?.exists() {
        relative = candidate(Some(n));
        n += 1;
    }
    vault.resolve(&relative).map_err(Into::into)
}

fn is_locally_dirty(vault: &Vault, path: &str, existing: Option<&db::FileState>) -> Result<bool> {
    let Ok(full) = vault.resolve(path) else {
        return Ok(false);
    };
    let Ok(bytes) = std::fs::read(&full) else {
        return Ok(false); // doesn't exist locally — nothing to conflict with
    };
    match existing {
        Some(state) => Ok(content_hash(&bytes) != state.content_hash),
        None => Ok(true), // exists locally but was never tracked as synced
    }
}

impl ServerSync {
    /// Opens (creating if needed) the local sync-state database for
    /// `vault`, under `.nodus/` alongside history/index — never synced
    /// itself (`.nodus/` is already excluded from the Git backend's
    /// tracked paths, and is exactly the kind of derived data the server
    /// sync engine also has no business uploading).
    pub fn open(
        vault: Vault,
        base_url: impl Into<String>,
        token: impl Into<String>,
        dek: Option<Dek>,
        device_name: impl Into<String>,
    ) -> Result<Self> {
        let db_path = vault.root().join(".nodus").join("server-sync.db");
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let db = db::open(&db_path)?;
        Ok(Self {
            client: ServerSyncClient::new(base_url, token),
            vault,
            db,
            dek,
            device_name: device_name.into(),
        })
    }

    pub fn client(&self) -> &ServerSyncClient {
        &self.client
    }

    pub fn set_dek(&mut self, dek: Option<Dek>) {
        self.dek = dek;
    }

    /// One full sync pass: pull whatever the server has that we don't,
    /// then push whatever we have that the server doesn't. Safe to call
    /// repeatedly (e.g. on an interval, or after reconnecting from
    /// offline) — nothing here assumes it's the first or only call.
    pub fn sync_once(&mut self) -> Result<SyncReport> {
        let mut report = SyncReport::default();
        self.pull(&mut report)?;
        self.push(&mut report)?;
        Ok(report)
    }

    fn pull(&mut self, report: &mut SyncReport) -> Result<()> {
        let dek = self.dek.clone();
        let known = db::all_known_versions(&self.db)?;
        let changed = self.client.diff(&known)?;

        for entry in changed {
            let existing = db::find_by_blob_id(&self.db, &entry.id)?;
            let path = match &existing {
                Some(state) => state.path.clone(),
                None => match &entry.encrypted_path {
                    Some(encoded) => decode_path_metadata(dek.as_ref(), encoded)?,
                    // A tombstone or update for a blob id we've never heard
                    // of and that carries no path metadata either — nothing
                    // useful we can do with it locally.
                    None => continue,
                },
            };

            if entry.deleted {
                self.apply_deletion(&path, report)?;
                continue;
            }

            self.apply_update(&path, &entry, existing.as_ref(), dek.as_ref(), report)?;
        }
        Ok(())
    }

    fn apply_deletion(&mut self, path: &str, report: &mut SyncReport) -> Result<()> {
        let existing = db::find_by_path(&self.db, path)?;
        let dirty = is_locally_dirty(&self.vault, path, existing.as_ref())?;
        if !dirty {
            if let Ok(full) = self.vault.resolve(path) {
                let _ = std::fs::remove_file(full);
            }
            db::delete(&self.db, path)?;
            report.deleted_locally.push(path.to_string());
        } else {
            // Deleted remotely, but we have an unsynced local edit — the
            // local file survives. Forgetting the tracking row means our
            // next push treats it as a brand-new file, uploading it again.
            db::delete(&self.db, path)?;
        }
        Ok(())
    }

    fn apply_update(
        &mut self,
        path: &str,
        entry: &ChangedFile,
        existing: Option<&db::FileState>,
        dek: Option<&Dek>,
        report: &mut SyncReport,
    ) -> Result<()> {
        let mut remote_plaintext = Vec::new();
        for chunk_id in &entry.chunk_ids {
            let bytes = self.client.download_chunk(chunk_id)?;
            remote_plaintext.extend(decrypt_chunk_bytes(dek, &bytes)?);
        }

        let dirty = is_locally_dirty(&self.vault, path, existing)?;
        let full = self.vault.resolve(path)?;

        if !dirty {
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&full, &remote_plaintext)?;
            db::upsert(
                &self.db,
                path,
                &entry.id,
                entry.version,
                &entry.chunk_ids,
                &content_hash(&remote_plaintext),
                &remote_plaintext,
            )?;
            report.downloaded.push(path.to_string());
            return Ok(());
        }

        // Both sides changed since the version we last synced — try an
        // automatic merge first, and only keep both copies if real
        // conflicting hunks remain.
        let local_bytes = std::fs::read(&full).unwrap_or_default();
        let merged = existing.and_then(|state| {
            try_merge_text(
                path,
                &state.content_snapshot,
                &local_bytes,
                &remote_plaintext,
            )
        });

        match merged {
            Some(merged_bytes) => {
                std::fs::write(&full, &merged_bytes)?;
                // Tracking now points at the remote version we merged from;
                // content_hash is the *local* (pre-write) hash so the push
                // phase still recognizes the merged file as changed and
                // uploads it as the next version.
                db::upsert(
                    &self.db,
                    path,
                    &entry.id,
                    entry.version,
                    &entry.chunk_ids,
                    &content_hash(&local_bytes),
                    &remote_plaintext,
                )?;
                report.conflicts.push(path.to_string());
            }
            None => {
                // The remote version becomes canonical at the original
                // path (matching what every other device already sees),
                // and this device's own unsynced edit is preserved as a
                // sibling copy — never discarded. That sibling is a brand
                // new, untracked file, so the push phase running right
                // after this pull picks it up like any other new local
                // file and syncs it to everyone else on its own.
                let sibling = conflict_copy_path(&self.vault, path, &self.device_name)?;
                if let Some(parent) = sibling.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&sibling, &local_bytes)?;
                std::fs::write(&full, &remote_plaintext)?;
                db::upsert(
                    &self.db,
                    path,
                    &entry.id,
                    entry.version,
                    &entry.chunk_ids,
                    &content_hash(&remote_plaintext),
                    &remote_plaintext,
                )?;
                report.conflicts.push(path.to_string());
            }
        }
        Ok(())
    }

    fn push(&mut self, report: &mut SyncReport) -> Result<()> {
        let dek = self.dek.clone();
        let mut still_present = std::collections::HashSet::new();
        for path in crate::attachments::list_all_files(&self.vault) {
            still_present.insert(path.clone());
            self.push_one(&path, dek.as_ref(), report)?;
        }

        // Anything still tracked but no longer present on disk was deleted
        // locally since the last sync — tell the server, so it doesn't keep
        // resurrecting on every other device forever.
        for path in db::all_paths(&self.db)? {
            if !still_present.contains(&path) {
                self.push_deletion(&path, report)?;
            }
        }
        Ok(())
    }

    fn push_deletion(&mut self, path: &str, report: &mut SyncReport) -> Result<()> {
        let Some(state) = db::find_by_path(&self.db, path)? else {
            return Ok(());
        };
        match self.client.delete_blob(&state.blob_id, state.version)? {
            PutOutcome::Committed { .. } => {
                db::delete(&self.db, path)?;
                report.deleted_remotely.push(path.to_string());
            }
            PutOutcome::Conflict { .. } => {
                // Someone else changed this file since we last synced it —
                // the next pull will surface their version and we'll
                // reconcile then, rather than blindly deleting it out from
                // under their edit.
            }
        }
        Ok(())
    }

    fn push_one(&mut self, path: &str, dek: Option<&Dek>, report: &mut SyncReport) -> Result<()> {
        let Ok(full) = self.vault.resolve(path) else {
            return Ok(());
        };
        let Ok(bytes) = std::fs::read(&full) else {
            return Ok(());
        };
        let hash = content_hash(&bytes);

        let state = db::find_by_path(&self.db, path)?;
        let changed = state
            .as_ref()
            .map(|s| s.content_hash != hash)
            .unwrap_or(true);
        if !changed {
            return Ok(());
        }

        let blob_id = state
            .as_ref()
            .map(|s| s.blob_id.clone())
            .unwrap_or_else(|| blob_id_for_path(dek, path));
        let base_version = state.as_ref().map(|s| s.version).unwrap_or(0);
        let chunks = chunk_content(dek, &bytes);
        let chunk_ids: Vec<String> = chunks.iter().map(|(id, _)| id.clone()).collect();

        let missing = self.client.missing_chunks(&chunk_ids)?;
        for (id, data) in &chunks {
            if missing.contains(id) {
                self.client.upload_chunk(id, data)?;
            }
        }

        let encoded_path = encode_path_metadata(dek, path);
        match self
            .client
            .put_blob(&blob_id, base_version, &chunk_ids, encoded_path)?
        {
            PutOutcome::Committed { version } => {
                db::upsert(&self.db, path, &blob_id, version, &chunk_ids, &hash, &bytes)?;
                report.uploaded.push(path.to_string());
            }
            PutOutcome::Conflict { .. } => {
                // Someone else's change landed between our diff and our
                // push. Leave local tracking untouched — the next
                // sync_once() call re-pulls, applies the same
                // merge-or-keep-both handling, and this push retries with
                // the corrected base version.
            }
        }
        Ok(())
    }
}

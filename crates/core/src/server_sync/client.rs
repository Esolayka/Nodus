//! Thin HTTP client for the `nodus-sync-server` protocol. Deliberately
//! stateless — every method takes exactly what it needs and returns exactly
//! what the server said, so the actual sync policy (what to upload, how to
//! resolve a conflict) stays entirely in [`super::ServerSync`], which is the
//! part that can be tested without a real server if needed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("network error talking to the sync server: {0}")]
    Http(#[from] reqwest::Error),
    #[error("sync server error ({status}): {message}")]
    Server { status: u16, message: String },
}

pub type Result<T> = std::result::Result<T, ClientError>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub id: String,
    pub version: u64,
    pub deleted: bool,
    pub chunk_ids: Vec<String>,
    pub encrypted_path: Option<String>,
}

#[derive(Debug)]
pub enum PutOutcome {
    Committed {
        version: u64,
    },
    Conflict {
        current_version: u64,
        chunk_ids: Vec<String>,
        deleted: bool,
        encrypted_path: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConflictBody {
    current_version: u64,
    chunk_ids: Vec<String>,
    deleted: bool,
    encrypted_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VersionBody {
    version: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStartResponse {
    pub code: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCompleteResponse {
    pub token: String,
    pub device_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub used_bytes: u64,
    pub max_bytes: Option<u64>,
    pub max_file_size_bytes: Option<u64>,
}

pub struct ServerSyncClient {
    http: reqwest::blocking::Client,
    base_url: String,
    token: String,
}

impl ServerSyncClient {
    pub fn new(base_url: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            http: reqwest::blocking::Client::new(),
            base_url: base_url.into(),
            token: token.into(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url.trim_end_matches('/'), path)
    }

    fn server_error(resp: reqwest::blocking::Response) -> ClientError {
        let status = resp.status().as_u16();
        let message = resp.text().unwrap_or_default();
        ClientError::Server { status, message }
    }

    pub fn pair_complete(
        base_url: &str,
        code: &str,
        device_name: &str,
    ) -> Result<PairCompleteResponse> {
        let http = reqwest::blocking::Client::new();
        let resp = http
            .post(format!(
                "{}/v1/devices/pair/complete",
                base_url.trim_end_matches('/')
            ))
            .json(&serde_json::json!({ "code": code, "deviceName": device_name }))
            .send()?;
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(resp.json()?)
    }

    pub fn pair_start(&self) -> Result<PairStartResponse> {
        let resp = self
            .http
            .post(self.url("/v1/devices/pair/start"))
            .bearer_auth(&self.token)
            .send()?;
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(resp.json()?)
    }

    pub fn diff(&self, versions: &HashMap<String, u64>) -> Result<Vec<ChangedFile>> {
        #[derive(Deserialize)]
        struct DiffResponse {
            changed: Vec<ChangedFile>,
        }
        let resp = self
            .http
            .post(self.url("/v1/sync/diff"))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "versions": versions }))
            .send()?;
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(resp.json::<DiffResponse>()?.changed)
    }

    pub fn missing_chunks(&self, ids: &[String]) -> Result<Vec<String>> {
        #[derive(Deserialize)]
        struct MissingResponse {
            missing: Vec<String>,
        }
        let resp = self
            .http
            .post(self.url("/v1/chunks/missing"))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "ids": ids }))
            .send()?;
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(resp.json::<MissingResponse>()?.missing)
    }

    pub fn upload_chunk(&self, id: &str, bytes: &[u8]) -> Result<()> {
        let resp = self
            .http
            .put(self.url(&format!("/v1/chunks/{id}")))
            .bearer_auth(&self.token)
            .body(bytes.to_vec())
            .send()?;
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(())
    }

    pub fn download_chunk(&self, id: &str) -> Result<Vec<u8>> {
        let resp = self
            .http
            .get(self.url(&format!("/v1/chunks/{id}")))
            .bearer_auth(&self.token)
            .send()?;
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(resp.bytes()?.to_vec())
    }

    pub fn put_blob(
        &self,
        id: &str,
        base_version: u64,
        chunk_ids: &[String],
        encrypted_path: Option<String>,
    ) -> Result<PutOutcome> {
        let resp = self
            .http
            .put(self.url(&format!("/v1/sync/blob/{id}")))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({
                "baseVersion": base_version,
                "chunkIds": chunk_ids,
                "encryptedPath": encrypted_path,
            }))
            .send()?;
        Self::handle_write_response(resp)
    }

    pub fn delete_blob(&self, id: &str, base_version: u64) -> Result<PutOutcome> {
        let resp = self
            .http
            .delete(self.url(&format!("/v1/sync/blob/{id}")))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "baseVersion": base_version }))
            .send()?;
        Self::handle_write_response(resp)
    }

    fn handle_write_response(resp: reqwest::blocking::Response) -> Result<PutOutcome> {
        if resp.status() == reqwest::StatusCode::CONFLICT {
            let body: ConflictBody = resp.json()?;
            return Ok(PutOutcome::Conflict {
                current_version: body.current_version,
                chunk_ids: body.chunk_ids,
                deleted: body.deleted,
                encrypted_path: body.encrypted_path,
            });
        }
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(PutOutcome::Committed {
            version: resp.json::<VersionBody>()?.version,
        })
    }

    pub fn storage_usage(&self) -> Result<StorageUsage> {
        let resp = self
            .http
            .get(self.url("/v1/storage/usage"))
            .bearer_auth(&self.token)
            .send()?;
        if !resp.status().is_success() {
            return Err(Self::server_error(resp));
        }
        Ok(resp.json()?)
    }
}

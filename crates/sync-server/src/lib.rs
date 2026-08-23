//! Self-hosted sync server for Nodus.
//!
//! What this service knows: device tokens, per-file version numbers, and
//! content-addressed chunk bytes. What it never knows: an encryption key.
//! When the client has encryption turned on, every chunk it stores is
//! ciphertext, every blob id and chunk id is a keyed HMAC computed with a
//! key that never leaves the device, and even the manifest linking chunks
//! to a file reveals nothing about the file's real name. This service is
//! not "trusted not to peek" — it is architecturally unable to.
//!
//! - [`db`] — SQLite metadata: devices, pairing codes, file versions, chunk
//!   existence and reference counts.
//! - [`storage`] — chunk bytes on disk, content-addressed by id.
//! - [`gc`] — sweeps chunks no file's current manifest references any more.
//! - [`auth`] — the `Authorization: Bearer <token>` device extractor.
//! - [`routes`] — the HTTP surface; [`build_router`] assembles it.

pub mod auth;
pub mod db;
pub mod error;
pub mod gc;
pub mod routes;
pub mod state;
pub mod storage;

pub use routes::build_router;
pub use state::AppState;

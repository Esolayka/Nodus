//! Hiding the vault's structure and note titles from whoever holds the sync
//! server — half the point of encrypting at all, per the spec this is
//! built against: a server that can't read file contents but can see
//! `"2026 Performance Review.md"` in a directory listing hasn't actually
//! protected anything sensitive.

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::content;
use crate::error::{Error, Result};
use crate::keys::Dek;

type HmacSha256 = Hmac<Sha256>;

/// A deterministic, non-reversible identifier for `relative_path` — the
/// same path always yields the same id (so the sync protocol can recognize
/// "this is still the same file" across syncs), but nothing about the path
/// can be recovered from the id itself.
pub fn blob_id_for_path(dek: &Dek, relative_path: &str) -> String {
    let key = crate::keys::path_hmac_key(dek);
    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC accepts any key length");
    mac.update(relative_path.as_bytes());
    hex::encode(mac.finalize_into_bytes())
}

/// Encrypts the real path for storage in a blob's own metadata record, so
/// the *client* can recover "this id is really `Notes/Idea.md`" after a
/// fresh pull. Deliberately not deterministic (a fresh nonce every call) —
/// unlike the id above, linking two ciphertexts of the same path across
/// time (e.g. a file deleted and later recreated) isn't something this
/// needs to support, and not supporting it is strictly safer.
pub fn encrypt_path(dek: &Dek, relative_path: &str) -> String {
    let key = crate::keys::content_key(dek);
    hex::encode(content::encrypt(&key, relative_path.as_bytes()))
}

pub fn decrypt_path(dek: &Dek, encrypted: &str) -> Result<String> {
    let key = crate::keys::content_key(dek);
    let bytes = hex::decode(encrypted).map_err(|_| Error::MalformedCiphertext)?;
    let plain = content::decrypt(&key, &bytes)?;
    String::from_utf8(plain).map_err(|_| Error::MalformedCiphertext)
}

trait FinalizeIntoBytes {
    fn finalize_into_bytes(self) -> Vec<u8>;
}
impl FinalizeIntoBytes for HmacSha256 {
    fn finalize_into_bytes(self) -> Vec<u8> {
        self.finalize().into_bytes().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_path_and_key_always_yields_the_same_id() {
        let dek = Dek::generate();
        let a = blob_id_for_path(&dek, "Projects/Idea.md");
        let b = blob_id_for_path(&dek, "Projects/Idea.md");
        assert_eq!(a, b);
    }

    #[test]
    fn different_paths_yield_different_ids() {
        let dek = Dek::generate();
        let a = blob_id_for_path(&dek, "Projects/Idea.md");
        let b = blob_id_for_path(&dek, "Projects/Other.md");
        assert_ne!(a, b);
    }

    #[test]
    fn different_deks_yield_different_ids_for_the_same_path() {
        let a = blob_id_for_path(&Dek::generate(), "Notes/Same.md");
        let b = blob_id_for_path(&Dek::generate(), "Notes/Same.md");
        assert_ne!(a, b);
    }

    #[test]
    fn id_does_not_literally_contain_the_path() {
        let dek = Dek::generate();
        let id = blob_id_for_path(&dek, "2026 Performance Review.md");
        assert!(!id.to_lowercase().contains("performance"));
        assert!(!id.to_lowercase().contains("review"));
    }

    #[test]
    fn encrypted_path_roundtrips() {
        let dek = Dek::generate();
        let encrypted = encrypt_path(&dek, "Journal/2026-01-01.md");
        assert_eq!(
            decrypt_path(&dek, &encrypted).unwrap(),
            "Journal/2026-01-01.md"
        );
    }

    #[test]
    fn encrypted_path_does_not_reveal_the_name() {
        let dek = Dek::generate();
        let encrypted = encrypt_path(&dek, "Secret Diary.md");
        assert!(!encrypted.to_lowercase().contains("secret"));
        assert!(!encrypted.to_lowercase().contains("diary"));
    }

    #[test]
    fn encrypting_the_same_path_twice_gives_different_ciphertext() {
        let dek = Dek::generate();
        let a = encrypt_path(&dek, "Notes/Same.md");
        let b = encrypt_path(&dek, "Notes/Same.md");
        assert_ne!(
            a, b,
            "path encryption uses a fresh nonce, unlike the blob id"
        );
    }

    #[test]
    fn decrypt_path_fails_with_the_wrong_dek() {
        let dek = Dek::generate();
        let encrypted = encrypt_path(&dek, "Notes/Same.md");
        assert!(decrypt_path(&Dek::generate(), &encrypted).is_err());
    }
}

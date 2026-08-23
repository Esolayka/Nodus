//! The one AEAD primitive everything else in this crate builds on: wrapping
//! the data-encryption key and encrypting file content are the same
//! operation applied to different plaintexts.

use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{AeadCore, XChaCha20Poly1305, XNonce};

use crate::error::{Error, Result};

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 24;

/// Encrypts `plaintext` under `key`, with a fresh random nonce every call.
/// Output is `nonce || ciphertext_with_tag` — self-contained, nothing else
/// needs to be stored alongside it to decrypt later.
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Vec<u8> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    // A fresh random 192-bit nonce every call is safe by construction — this
    // is exactly the case XChaCha20's extended nonce exists for, unlike
    // AES-GCM's 96-bit nonce, which would need a counter at this volume.
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .expect("XChaCha20-Poly1305 encryption cannot fail for valid inputs");
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    out
}

/// Decrypts data produced by [`encrypt`]. Fails closed on any tampering —
/// a flipped bit anywhere in the ciphertext or tag is a hard error, never
/// garbage plaintext.
pub fn decrypt(key: &[u8; KEY_LEN], data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return Err(Error::MalformedCiphertext);
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let nonce = XNonce::from_slice(nonce_bytes);
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| Error::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> [u8; KEY_LEN] {
        [7u8; KEY_LEN]
    }

    #[test]
    fn roundtrips() {
        let ciphertext = encrypt(&key(), b"hello, vault");
        assert_eq!(decrypt(&key(), &ciphertext).unwrap(), b"hello, vault");
    }

    #[test]
    fn empty_plaintext_roundtrips() {
        let ciphertext = encrypt(&key(), b"");
        assert_eq!(decrypt(&key(), &ciphertext).unwrap(), b"");
    }

    #[test]
    fn two_encryptions_of_the_same_plaintext_differ() {
        // Different random nonces each call — ciphertexts must not match,
        // or an observer could tell two files are identical without
        // decrypting them.
        let a = encrypt(&key(), b"same content");
        let b = encrypt(&key(), b"same content");
        assert_ne!(a, b);
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let ciphertext = encrypt(&key(), b"secret");
        let wrong_key = [9u8; KEY_LEN];
        assert!(decrypt(&wrong_key, &ciphertext).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected_not_garbled() {
        let mut ciphertext = encrypt(&key(), b"do not tamper with me");
        let last = ciphertext.len() - 1;
        ciphertext[last] ^= 0x01;
        assert!(decrypt(&key(), &ciphertext).is_err());
    }

    #[test]
    fn tampered_nonce_is_also_rejected() {
        let mut ciphertext = encrypt(&key(), b"content");
        ciphertext[0] ^= 0x01;
        assert!(decrypt(&key(), &ciphertext).is_err());
    }

    #[test]
    fn truncated_data_is_rejected() {
        assert!(decrypt(&key(), b"too short").is_err());
    }
}

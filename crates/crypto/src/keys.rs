//! The vault's actual data-encryption key (DEK): generated once, at random,
//! and never derived from anything a human could forget or be tricked into
//! reusing elsewhere. It's wrapped (encrypted) under one or more
//! key-encrypting keys (KEKs) — one per unlock method (password, recovery
//! phrase) — so changing a password only ever re-wraps this one small key,
//! never the vault's content.

use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::content;
use crate::error::Result;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Dek(pub [u8; content::KEY_LEN]);

impl Dek {
    pub fn generate() -> Self {
        let mut bytes = [0u8; content::KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }
}

/// A DEK, encrypted under some KEK — safe to write to disk or send to a
/// server, since without the matching password/phrase it's just bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedDek {
    /// Hex-encoded `nonce || ciphertext`.
    pub wrapped: String,
}

pub fn wrap_dek(dek: &Dek, kek: &[u8; content::KEY_LEN]) -> WrappedDek {
    let wrapped = content::encrypt(kek, &dek.0);
    WrappedDek {
        wrapped: hex::encode(wrapped),
    }
}

pub fn unwrap_dek(wrapped: &WrappedDek, kek: &[u8; content::KEY_LEN]) -> Result<Dek> {
    let bytes =
        hex::decode(&wrapped.wrapped).map_err(|_| crate::error::Error::MalformedCiphertext)?;
    let plain = content::decrypt(kek, &bytes)?;
    let array: [u8; content::KEY_LEN] = plain
        .try_into()
        .map_err(|_| crate::error::Error::MalformedCiphertext)?;
    Ok(Dek(array))
}

/// The DEK is never used directly for two different cryptographic purposes
/// — content encryption and path-hiding each get their own sub-key, derived
/// via HKDF with a distinct label. Key separation like this is cheap and
/// standard practice; reusing one raw key for both AEAD and HMAC would work
/// in practice but is exactly the kind of shortcut a crypto review flags.
fn derive_subkey(dek: &Dek, label: &[u8]) -> [u8; content::KEY_LEN] {
    let hk = Hkdf::<Sha256>::new(None, &dek.0);
    let mut out = [0u8; content::KEY_LEN];
    hk.expand(label, &mut out)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

pub fn content_key(dek: &Dek) -> [u8; content::KEY_LEN] {
    derive_subkey(dek, b"nodus-content-key-v1")
}

pub fn path_hmac_key(dek: &Dek) -> [u8; content::KEY_LEN] {
    derive_subkey(dek, b"nodus-path-hmac-key-v1")
}

pub fn chunk_hmac_key(dek: &Dek) -> [u8; content::KEY_LEN] {
    derive_subkey(dek, b"nodus-chunk-hmac-key-v1")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kdf;

    #[test]
    fn wrap_and_unwrap_roundtrips() {
        let dek = Dek::generate();
        let kek = [3u8; content::KEY_LEN];
        let wrapped = wrap_dek(&dek, &kek);
        let unwrapped = unwrap_dek(&wrapped, &kek).unwrap();
        assert_eq!(dek.0, unwrapped.0);
    }

    #[test]
    fn unwrap_fails_with_the_wrong_kek() {
        let dek = Dek::generate();
        let kek = [3u8; content::KEY_LEN];
        let wrapped = wrap_dek(&dek, &kek);
        let wrong_kek = [4u8; content::KEY_LEN];
        assert!(unwrap_dek(&wrapped, &wrong_kek).is_err());
    }

    #[test]
    fn password_derived_kek_unwraps_only_with_the_right_password() {
        let dek = Dek::generate();
        let salt = kdf::random_salt();
        let kek = kdf::derive_kek(b"my password", &salt).unwrap();
        let wrapped = wrap_dek(&dek, &kek);

        let same_kek = kdf::derive_kek(b"my password", &salt).unwrap();
        assert_eq!(unwrap_dek(&wrapped, &same_kek).unwrap().0, dek.0);

        let wrong_kek = kdf::derive_kek(b"wrong password", &salt).unwrap();
        assert!(unwrap_dek(&wrapped, &wrong_kek).is_err());
    }

    #[test]
    fn content_and_path_subkeys_are_distinct_and_deterministic() {
        let dek = Dek::generate();
        let content_a = content_key(&dek);
        let content_b = content_key(&dek);
        let path_key = path_hmac_key(&dek);
        let chunk_key = chunk_hmac_key(&dek);
        assert_eq!(
            content_a, content_b,
            "deriving twice from the same DEK must agree"
        );
        assert_ne!(
            content_a, path_key,
            "content and path sub-keys must not collide"
        );
        assert_ne!(
            content_a, chunk_key,
            "content and chunk sub-keys must not collide"
        );
        assert_ne!(
            path_key, chunk_key,
            "path and chunk sub-keys must not collide"
        );
    }

    #[test]
    fn same_dek_can_be_wrapped_under_two_independent_keks() {
        // Models password + recovery phrase both unlocking the same vault.
        let dek = Dek::generate();
        let password_kek = [1u8; content::KEY_LEN];
        let recovery_kek = [2u8; content::KEY_LEN];

        let wrapped_by_password = wrap_dek(&dek, &password_kek);
        let wrapped_by_recovery = wrap_dek(&dek, &recovery_kek);

        assert_eq!(
            unwrap_dek(&wrapped_by_password, &password_kek).unwrap().0,
            dek.0
        );
        assert_eq!(
            unwrap_dek(&wrapped_by_recovery, &recovery_kek).unwrap().0,
            dek.0
        );
    }
}

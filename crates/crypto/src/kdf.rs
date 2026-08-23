//! Turns a human secret (password or recovery phrase) into a fixed-size key,
//! via Argon2id. Both secrets go through the exact same function — a
//! recovery phrase is just a second human secret with its own salt, not a
//! different mechanism.

use argon2::{Algorithm, Argon2, Params, Version};

use crate::error::{Error, Result};

pub const SALT_LEN: usize = 16;
pub const KEY_LEN: usize = 32;

/// 64 MiB / 3 passes / 4 lanes — comfortably above OWASP's baseline
/// recommendation for Argon2id, and fast enough for an interactive desktop
/// unlock (this runs once per session, not per request).
const MEMORY_KIB: u32 = 65536;
const ITERATIONS: u32 = 3;
const PARALLELISM: u32 = 4;

/// Derives a 32-byte key-encrypting key from `secret` (the raw UTF-8 bytes of
/// a password or a normalized recovery phrase) and `salt`. Deterministic:
/// the same secret and salt always produce the same key, which is what lets
/// unlocking re-derive the key from a password the user types again.
pub fn derive_kek(secret: &[u8], salt: &[u8; SALT_LEN]) -> Result<[u8; KEY_LEN]> {
    let params = Params::new(MEMORY_KIB, ITERATIONS, PARALLELISM, Some(KEY_LEN))
        .map_err(|e| Error::Kdf(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; KEY_LEN];
    argon2
        .hash_password_into(secret, salt, &mut out)
        .map_err(|e| Error::Kdf(e.to_string()))?;
    Ok(out)
}

pub fn random_salt() -> [u8; SALT_LEN] {
    use rand::RngCore;
    let mut salt = [0u8; SALT_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_secret_and_salt_derive_the_same_key() {
        let salt = random_salt();
        let a = derive_kek(b"correct horse battery staple", &salt).unwrap();
        let b = derive_kek(b"correct horse battery staple", &salt).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn different_salts_derive_different_keys_from_the_same_password() {
        let a = derive_kek(b"same password", &random_salt()).unwrap();
        let b = derive_kek(b"same password", &random_salt()).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn different_passwords_derive_different_keys() {
        let salt = random_salt();
        let a = derive_kek(b"password one", &salt).unwrap();
        let b = derive_kek(b"password two", &salt).unwrap();
        assert_ne!(a, b);
    }
}

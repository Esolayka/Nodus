//! A vault's "sync identity" — a random secret, independent of content
//! encryption, that exists purely so a device can announce itself to a
//! discovery service without that service ever learning whose computer it
//! is or where it leads. Two devices sharing a vault (desktop + Telegram
//! Mini App, or two desktops) derive the same lookup id and encryption key
//! from the same identity, so nothing about it needs to travel over the
//! wire except once, during account linking.
//!
//! Deliberately separate from [`crate::keys::Dek`]: a vault with content
//! encryption turned off still needs a private way for its own devices to
//! find each other — this doesn't depend on whether the user ever turns
//! content encryption on at all.

use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::content;
use crate::error::{Error, Result};

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SyncIdentity(pub [u8; content::KEY_LEN]);

impl SyncIdentity {
    pub fn generate() -> Self {
        let mut bytes = [0u8; content::KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }
}

fn derive_subkey(identity: &SyncIdentity, label: &[u8]) -> [u8; content::KEY_LEN] {
    let hk = Hkdf::<Sha256>::new(None, &identity.0);
    let mut out = [0u8; content::KEY_LEN];
    hk.expand(label, &mut out).expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

/// The opaque key a discovery service indexes announcements by. Anyone
/// holding the identity can compute it; nobody else can guess it, and
/// nobody can recover the identity from it (HKDF's one-wayness).
pub fn discovery_id(identity: &SyncIdentity) -> String {
    hex::encode(derive_subkey(identity, b"nodus-discovery-id-v1"))
}

fn encryption_key(identity: &SyncIdentity) -> [u8; content::KEY_LEN] {
    derive_subkey(identity, b"nodus-discovery-enc-key-v1")
}

/// Encrypts a tunnel address for announcing to the discovery service,
/// which only ever sees this ciphertext — never the address, and (via
/// [`discovery_id`] being a separate derivation) never anything linking
/// it back to a particular vault or person.
pub fn encrypt_address(identity: &SyncIdentity, address: &str) -> String {
    hex::encode(content::encrypt(&encryption_key(identity), address.as_bytes()))
}

pub fn decrypt_address(identity: &SyncIdentity, encrypted: &str) -> Result<String> {
    let bytes = hex::decode(encrypted).map_err(|_| Error::MalformedCiphertext)?;
    let plain = content::decrypt(&encryption_key(identity), &bytes)?;
    String::from_utf8(plain).map_err(|_| Error::MalformedCiphertext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_identity_yields_the_same_discovery_id() {
        let identity = SyncIdentity::generate();
        assert_eq!(discovery_id(&identity), discovery_id(&identity));
    }

    #[test]
    fn different_identities_yield_different_discovery_ids() {
        let a = SyncIdentity::generate();
        let b = SyncIdentity::generate();
        assert_ne!(discovery_id(&a), discovery_id(&b));
    }

    #[test]
    fn address_roundtrips_for_the_same_identity() {
        let identity = SyncIdentity::generate();
        let encrypted = encrypt_address(&identity, "https://abc123.trycloudflare.com");
        assert_eq!(decrypt_address(&identity, &encrypted).unwrap(), "https://abc123.trycloudflare.com");
    }

    #[test]
    fn address_does_not_decrypt_under_a_different_identity() {
        let identity = SyncIdentity::generate();
        let encrypted = encrypt_address(&identity, "https://abc123.trycloudflare.com");
        assert!(decrypt_address(&SyncIdentity::generate(), &encrypted).is_err());
    }

    #[test]
    fn encrypting_the_same_address_twice_gives_different_ciphertext() {
        let identity = SyncIdentity::generate();
        let a = encrypt_address(&identity, "https://abc123.trycloudflare.com");
        let b = encrypt_address(&identity, "https://abc123.trycloudflare.com");
        assert_ne!(a, b, "address encryption uses a fresh nonce, so repeated announces don't correlate");
    }

    #[test]
    fn discovery_id_does_not_literally_contain_the_identity_bytes() {
        let identity = SyncIdentity::generate();
        assert_ne!(discovery_id(&identity), hex::encode(identity.0));
    }
}

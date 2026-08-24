//! What actually gets persisted for an encrypted vault — never the DEK
//! itself in the clear, always wrapped under a KEK derived from something
//! the user holds (password or recovery phrase). This struct is the entire
//! contents of the vault's crypto config file; it's fine for it to be
//! world-readable, since without the password or phrase it's useless.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::kdf::{self, SALT_LEN};
use crate::keys::{self, Dek, WrappedDek};
use crate::recovery::{self, RecoveryPhrase};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultCryptoConfig {
    pub version: u32,
    password_salt: String,
    wrapped_dek_by_password: WrappedDek,
    recovery_salt: String,
    wrapped_dek_by_recovery: WrappedDek,
}

fn encode_salt(salt: &[u8; SALT_LEN]) -> String {
    hex::encode(salt)
}

fn decode_salt(hex_str: &str) -> Result<[u8; SALT_LEN]> {
    let bytes = hex::decode(hex_str).map_err(|_| Error::MalformedCiphertext)?;
    bytes.try_into().map_err(|_| Error::MalformedCiphertext)
}

impl VaultCryptoConfig {
    /// First-time setup: a random DEK, wrapped under both a password-derived
    /// KEK and a freshly generated recovery phrase's KEK. The phrase is
    /// returned alongside so the caller can show it to the user exactly
    /// once — it is never stored anywhere, only its derived KEK's wrapping
    /// of the DEK is.
    pub fn setup(password: &str) -> (Self, RecoveryPhrase) {
        let dek = Dek::generate();

        let password_salt = kdf::random_salt();
        let password_kek = kdf::derive_kek(password.as_bytes(), &password_salt)
            .expect("Argon2id params are fixed and valid");
        let wrapped_dek_by_password = keys::wrap_dek(&dek, &password_kek);

        let phrase = RecoveryPhrase::generate();
        let recovery_salt = kdf::random_salt();
        let recovery_kek = kdf::derive_kek(&phrase.secret_bytes(), &recovery_salt)
            .expect("Argon2id params are fixed and valid");
        let wrapped_dek_by_recovery = keys::wrap_dek(&dek, &recovery_kek);

        let config = Self {
            version: 1,
            password_salt: encode_salt(&password_salt),
            wrapped_dek_by_password,
            recovery_salt: encode_salt(&recovery_salt),
            wrapped_dek_by_recovery,
        };
        (config, phrase)
    }

    pub fn unlock_with_password(&self, password: &str) -> Result<Dek> {
        let salt = decode_salt(&self.password_salt)?;
        let kek =
            kdf::derive_kek(password.as_bytes(), &salt).map_err(|e| Error::Kdf(e.to_string()))?;
        keys::unwrap_dek(&self.wrapped_dek_by_password, &kek)
    }

    pub fn unlock_with_recovery_phrase(&self, phrase: &str) -> Result<Dek> {
        let secret = recovery::secret_bytes_from_phrase(phrase)?;
        let salt = decode_salt(&self.recovery_salt)?;
        let kek = kdf::derive_kek(&secret, &salt).map_err(|e| Error::Kdf(e.to_string()))?;
        keys::unwrap_dek(&self.wrapped_dek_by_recovery, &kek)
    }

    /// Re-wraps the (already-unlocked) DEK under a new password — the DEK
    /// itself, and therefore every already-encrypted file, is untouched.
    /// This is what keeps a password change instant regardless of vault
    /// size. The recovery-phrase wrapping is left exactly as it was: the
    /// phrase the user already wrote down keeps working.
    pub fn change_password(&self, dek: &Dek, new_password: &str) -> Self {
        let password_salt = kdf::random_salt();
        let password_kek = kdf::derive_kek(new_password.as_bytes(), &password_salt)
            .expect("Argon2id params are fixed and valid");
        Self {
            version: self.version,
            password_salt: encode_salt(&password_salt),
            wrapped_dek_by_password: keys::wrap_dek(dek, &password_kek),
            recovery_salt: self.recovery_salt.clone(),
            wrapped_dek_by_recovery: self.wrapped_dek_by_recovery.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_then_unlock_with_password() {
        let (config, _phrase) = VaultCryptoConfig::setup("hunter2 correct horse");
        let dek = config
            .unlock_with_password("hunter2 correct horse")
            .unwrap();
        assert_eq!(dek.0.len(), 32);
    }

    #[test]
    fn setup_then_unlock_with_recovery_phrase() {
        let (config, phrase) = VaultCryptoConfig::setup("hunter2 correct horse");
        let by_password = config
            .unlock_with_password("hunter2 correct horse")
            .unwrap();
        let by_recovery = config
            .unlock_with_recovery_phrase(&phrase.words().join(" "))
            .unwrap();
        assert_eq!(
            by_password.0, by_recovery.0,
            "both paths must unlock the same DEK"
        );
    }

    #[test]
    fn wrong_password_is_rejected() {
        let (config, _phrase) = VaultCryptoConfig::setup("the real password");
        assert!(config
            .unlock_with_password("not the real password")
            .is_err());
    }

    #[test]
    fn wrong_recovery_phrase_is_rejected() {
        let (config, _phrase) = VaultCryptoConfig::setup("password");
        let other = RecoveryPhrase::generate();
        assert!(config
            .unlock_with_recovery_phrase(&other.words().join(" "))
            .is_err());
    }

    #[test]
    fn losing_both_password_and_phrase_means_no_way_in() {
        // Not a "recover via magic" test — the opposite: confirming there is
        // no backdoor. Neither the wrong password nor a garbage phrase
        // unlocks anything.
        let (config, _phrase) = VaultCryptoConfig::setup("the one true password");
        assert!(config.unlock_with_password("guess 1").is_err());
        assert!(config
            .unlock_with_recovery_phrase(
                "twelve totally made up words that are not a real phrase at all yes"
            )
            .is_err());
    }

    #[test]
    fn change_password_keeps_the_same_dek_and_the_old_recovery_phrase_working() {
        let (config, phrase) = VaultCryptoConfig::setup("old password");
        let dek_before = config.unlock_with_password("old password").unwrap();

        let new_config = config.change_password(&dek_before, "new password");

        let dek_after = new_config.unlock_with_password("new password").unwrap();
        assert_eq!(
            dek_before.0, dek_after.0,
            "changing password must not rotate the DEK"
        );

        assert!(new_config.unlock_with_password("old password").is_err());

        let dek_via_recovery = new_config
            .unlock_with_recovery_phrase(&phrase.words().join(" "))
            .unwrap();
        assert_eq!(
            dek_via_recovery.0, dek_before.0,
            "the original recovery phrase must still work after a password change"
        );
    }

    #[test]
    fn config_serializes_to_json_and_back() {
        let (config, _phrase) = VaultCryptoConfig::setup("password");
        let json = serde_json::to_string(&config).unwrap();
        let restored: VaultCryptoConfig = serde_json::from_str(&json).unwrap();
        let dek_a = config.unlock_with_password("password").unwrap();
        let dek_b = restored.unlock_with_password("password").unwrap();
        assert_eq!(dek_a.0, dek_b.0);
    }
}

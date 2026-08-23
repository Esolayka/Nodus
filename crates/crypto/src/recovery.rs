//! The recovery phrase is a second, independent human secret — generated
//! for the user rather than chosen by them, so it carries real entropy
//! (128 bits, from a 12-word BIP39 phrase) instead of whatever a
//! human-picked password happens to have. It unlocks the vault through the
//! exact same Argon2id path a password does; BIP39 is used here only for
//! its wordlist and checksum, not its own (PBKDF2-based) seed derivation.

use bip39::Mnemonic;
use rand::RngCore;

use crate::error::{Error, Result};

/// 128 bits of entropy encodes to a 12-word BIP39 mnemonic.
const ENTROPY_LEN: usize = 16;

/// A freshly generated 12-word recovery phrase, not yet confirmed by the
/// user.
pub struct RecoveryPhrase(Mnemonic);

impl RecoveryPhrase {
    pub fn generate() -> Self {
        let mut entropy = [0u8; ENTROPY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut entropy);
        Self(Mnemonic::from_entropy(&entropy).expect("16 bytes is valid BIP39 entropy"))
    }

    /// The words to show the user, in order.
    pub fn words(&self) -> Vec<&'static str> {
        self.0.words().collect()
    }

    /// Bytes to feed into [`crate::kdf::derive_kek`] — the normalized phrase
    /// text, not BIP39's own PBKDF2 seed.
    pub fn secret_bytes(&self) -> Vec<u8> {
        self.0.to_string().into_bytes()
    }

    /// Validates what the user typed back during the "confirm you wrote it
    /// down" step — catches a mistyped or misheard word via BIP39's
    /// checksum, not just a straight string comparison, so a phrase that's
    /// *almost* right (and therefore useless in six months) is caught now.
    pub fn verify(&self, attempt: &str) -> bool {
        match Mnemonic::parse(attempt) {
            Ok(parsed) => parsed == self.0,
            Err(_) => false,
        }
    }
}

/// Parses a recovery phrase the user is typing back in to actually recover
/// a vault (as opposed to confirming a freshly generated one) — same
/// checksum validation, independent of any particular generated instance.
pub fn secret_bytes_from_phrase(phrase: &str) -> Result<Vec<u8>> {
    let mnemonic = Mnemonic::parse(phrase.trim()).map_err(|_| Error::InvalidRecoveryPhrase)?;
    Ok(mnemonic.to_string().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_twelve_words() {
        let phrase = RecoveryPhrase::generate();
        assert_eq!(phrase.words().len(), 12);
    }

    #[test]
    fn two_generated_phrases_differ() {
        let a = RecoveryPhrase::generate();
        let b = RecoveryPhrase::generate();
        assert_ne!(a.words(), b.words());
    }

    #[test]
    fn verify_accepts_the_exact_phrase_typed_back() {
        let phrase = RecoveryPhrase::generate();
        let typed = phrase.words().join(" ");
        assert!(phrase.verify(&typed));
    }

    #[test]
    fn verify_rejects_a_wrong_word() {
        let phrase = RecoveryPhrase::generate();
        let mut words = phrase.words();
        words[0] = if words[0] == "abandon" { "ability" } else { "abandon" };
        assert!(!phrase.verify(&words.join(" ")));
    }

    #[test]
    fn verify_rejects_garbage() {
        let phrase = RecoveryPhrase::generate();
        assert!(!phrase.verify("not a real recovery phrase at all"));
    }

    #[test]
    fn secret_bytes_from_phrase_matches_the_original_generation() {
        let phrase = RecoveryPhrase::generate();
        let typed = phrase.words().join(" ");
        let recovered = secret_bytes_from_phrase(&typed).unwrap();
        assert_eq!(recovered, phrase.secret_bytes());
    }

    #[test]
    fn secret_bytes_from_phrase_rejects_invalid_input() {
        assert!(secret_bytes_from_phrase("definitely not twelve valid bip39 words here").is_err());
    }
}

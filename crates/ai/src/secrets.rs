//! API keys never live in a settings file or in vault content — they go
//! straight into the OS's own credential store via `keyring` (macOS
//! Keychain, Windows Credential Manager, the Secret Service on Linux),
//! keyed by a caller-chosen provider id. Nothing here ever logs a key;
//! callers must be equally careful not to `Debug`-print whatever this
//! returns.

use crate::error::{ProviderError, Result};

const SERVICE_NAME: &str = "nodus-ai";

fn entry(provider_id: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE_NAME, provider_id)?)
}

pub fn store_api_key(provider_id: &str, key: &str) -> Result<()> {
    entry(provider_id)?.set_password(key)?;
    Ok(())
}

pub fn load_api_key(provider_id: &str) -> Result<Option<String>> {
    match entry(provider_id)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(ProviderError::Keyring(e)),
    }
}

pub fn delete_api_key(provider_id: &str) -> Result<()> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(ProviderError::Keyring(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These exercise the real OS credential store (whatever backend
    // `keyring` picks on this machine) rather than a mock, since a fake
    // in-memory store would prove nothing about the one actual
    // requirement here: the key ends up somewhere the OS protects, not
    // in a file Nodus controls.
    fn test_id(name: &str) -> String {
        format!("nodus-ai-test-{name}-{}", std::process::id())
    }

    #[test]
    fn stores_and_loads_a_key_through_the_real_os_keyring() {
        let id = test_id("roundtrip");
        store_api_key(&id, "sk-test-1234567890").unwrap();
        assert_eq!(load_api_key(&id).unwrap().as_deref(), Some("sk-test-1234567890"));
        delete_api_key(&id).unwrap();
        assert_eq!(load_api_key(&id).unwrap(), None);
    }

    #[test]
    fn a_key_that_was_never_stored_loads_as_none_rather_than_erroring() {
        let id = test_id("never-stored");
        assert_eq!(load_api_key(&id).unwrap(), None);
    }

    #[test]
    fn deleting_a_nonexistent_key_is_a_no_op_not_an_error() {
        let id = test_id("delete-missing");
        delete_api_key(&id).unwrap();
    }

    #[test]
    fn storing_again_overwrites_rather_than_erroring() {
        let id = test_id("overwrite");
        store_api_key(&id, "first-key").unwrap();
        store_api_key(&id, "second-key").unwrap();
        assert_eq!(load_api_key(&id).unwrap().as_deref(), Some("second-key"));
        delete_api_key(&id).unwrap();
    }
}

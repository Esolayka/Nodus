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

fn store_in_entry(entry: &keyring::Entry, key: &str) -> Result<()> {
    entry.set_password(key)?;
    Ok(())
}

fn load_from_entry(entry: &keyring::Entry) -> Result<Option<String>> {
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(ProviderError::Keyring(e)),
    }
}

fn delete_from_entry(entry: &keyring::Entry) -> Result<()> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(ProviderError::Keyring(e)),
    }
}

pub fn store_api_key(provider_id: &str, key: &str) -> Result<()> {
    store_in_entry(&entry(provider_id)?, key)
}

pub fn load_api_key(provider_id: &str) -> Result<Option<String>> {
    load_from_entry(&entry(provider_id)?)
}

pub fn delete_api_key(provider_id: &str) -> Result<()> {
    delete_from_entry(&entry(provider_id)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_entry() -> keyring::Entry {
        keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()))
    }

    #[test]
    fn stores_and_loads_a_key_through_a_credential_entry() {
        let entry = mock_entry();
        store_in_entry(&entry, "sk-test-1234567890").unwrap();
        assert_eq!(
            load_from_entry(&entry).unwrap().as_deref(),
            Some("sk-test-1234567890")
        );
        delete_from_entry(&entry).unwrap();
        assert_eq!(load_from_entry(&entry).unwrap(), None);
    }

    #[test]
    fn a_key_that_was_never_stored_loads_as_none_rather_than_erroring() {
        assert_eq!(load_from_entry(&mock_entry()).unwrap(), None);
    }

    #[test]
    fn deleting_a_nonexistent_key_is_a_no_op_not_an_error() {
        delete_from_entry(&mock_entry()).unwrap();
    }

    #[test]
    fn storing_again_overwrites_rather_than_erroring() {
        let entry = mock_entry();
        store_in_entry(&entry, "first-key").unwrap();
        store_in_entry(&entry, "second-key").unwrap();
        assert_eq!(
            load_from_entry(&entry).unwrap().as_deref(),
            Some("second-key")
        );
        delete_from_entry(&entry).unwrap();
    }
}

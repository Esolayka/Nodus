use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::vault::Vault;

/// Self-writes are suppressed for this long: long enough to absorb the
/// debouncer's own latency, short enough that a real external edit right
/// after our save is still noticed.
const SELF_WRITE_GRACE: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
}

#[derive(Debug, Clone, Serialize)]
pub struct FsChange {
    pub kind: ChangeKind,
    pub path: String,
}

/// Watches a vault for on-disk changes, filtering out the app's own writes
/// so it doesn't react to itself.
pub struct VaultWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
    recent_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl VaultWatcher {
    pub fn watch<F>(vault: &Vault, mut on_change: F) -> Result<Self>
    where
        F: FnMut(FsChange) + Send + 'static,
    {
        let recent_writes: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let recent_writes_for_handler = recent_writes.clone();
        let root = vault.root().to_path_buf();

        let mut debouncer = new_debouncer(
            Duration::from_millis(400),
            None,
            move |result: DebounceEventResult| {
                let Ok(events) = result else {
                    return;
                };
                for event in events {
                    for path in &event.paths {
                        if is_ignored(&root, path) {
                            continue;
                        }
                        if was_recent_self_write(&recent_writes_for_handler, path) {
                            continue;
                        }
                        let Some(kind) = classify(&event.event.kind) else {
                            continue;
                        };
                        let Ok(relative) = Vault::relativize_static(&root, path) else {
                            continue;
                        };
                        on_change(FsChange {
                            kind,
                            path: relative,
                        });
                    }
                }
            },
        )
        .map_err(|e| Error::Watch(e.to_string()))?;

        debouncer
            .watch(vault.root(), RecursiveMode::Recursive)
            .map_err(|e| Error::Watch(e.to_string()))?;

        Ok(Self {
            _debouncer: debouncer,
            recent_writes,
        })
    }

    /// Call right after the app itself writes `absolute_path`, so the
    /// resulting filesystem event isn't reported back as an external change.
    pub fn mark_self_write(&self, absolute_path: &Path) {
        if let Ok(mut writes) = self.recent_writes.lock() {
            writes.insert(absolute_path.to_path_buf(), Instant::now());
            writes.retain(|_, at| at.elapsed() < SELF_WRITE_GRACE);
        }
    }
}

/// Ignores anything under a dot-prefixed path component, at any depth — not
/// just top-level dirs like `.nodus`, but also the `.name.nodus-tmp-1234`
/// scratch files atomic writes create next to the note they're replacing.
fn is_ignored(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return true;
    };
    relative.components().any(|c| {
        c.as_os_str()
            .to_str()
            .map(|s| s.starts_with('.'))
            .unwrap_or(true)
    })
}

fn was_recent_self_write(
    recent_writes: &Arc<Mutex<HashMap<PathBuf, Instant>>>,
    path: &Path,
) -> bool {
    let Ok(mut writes) = recent_writes.lock() else {
        return false;
    };
    if let Some(at) = writes.get(path) {
        if at.elapsed() < SELF_WRITE_GRACE {
            return true;
        }
        writes.remove(path);
    }
    false
}

fn classify(kind: &notify::EventKind) -> Option<ChangeKind> {
    use notify::EventKind::*;
    match kind {
        Create(_) => Some(ChangeKind::Created),
        Modify(_) => Some(ChangeKind::Modified),
        Remove(_) => Some(ChangeKind::Removed),
        _ => None,
    }
}

impl Vault {
    /// Same as [`Vault::relativize`] but usable from the watcher's callback,
    /// which only has the root path, not a `&Vault`.
    fn relativize_static(root: &Path, absolute: &Path) -> Result<String> {
        let rel = absolute
            .strip_prefix(root)
            .map_err(|_| Error::PathEscapesVault(absolute.display().to_string()))?;
        let parts: Vec<&str> = rel
            .components()
            .map(|c| c.as_os_str().to_str().unwrap_or_default())
            .collect();
        Ok(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn detects_external_file_creation() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let (tx, rx) = mpsc::channel();

        let watcher = VaultWatcher::watch(&vault, move |change| {
            let _ = tx.send(change);
        })
        .unwrap();

        std::fs::write(dir.path().join("external.md"), "hello").unwrap();

        let change = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("expected a change event");
        assert_eq!(change.path, "external.md");
        drop(watcher);
    }

    #[test]
    fn self_write_is_suppressed() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let (tx, rx) = mpsc::channel();

        let watcher = VaultWatcher::watch(&vault, move |change| {
            let _ = tx.send(change);
        })
        .unwrap();

        let path = dir.path().join("mine.md");
        watcher.mark_self_write(&path);
        std::fs::write(&path, "hello").unwrap();

        // No event should arrive for the self-write within the debounce window.
        assert!(rx.recv_timeout(Duration::from_millis(900)).is_err());
    }
}

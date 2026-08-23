//! Git as a sync mechanism: the vault root doubles as a Git working
//! directory, and libgit2 (via `git2`) does the actual version control —
//! this module's job is just to drive it the way the app's UI needs
//! (status/commit/push/pull as single calls, structured conflicts instead
//! of raw marker text) rather than reimplementing any of it.

pub mod conflict;

use std::collections::HashMap;
use std::path::Path;

use git2::{
    AutotagOption, Cred, FetchOptions, IndexAddOption, MergeOptions, PushOptions, RemoteCallbacks,
    Repository, Signature, Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use conflict::{ConflictChoice, MergeSegment};

#[derive(Debug, Error)]
pub enum GitError {
    #[error(transparent)]
    Git(#[from] git2::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("not currently in the middle of a merge")]
    NotMerging,
    #[error("path is not conflicted: {0}")]
    NotConflicted(String),
}

pub type Result<T> = std::result::Result<T, GitError>;

/// How a Git remote should authenticate. `None` covers local `file://`
/// remotes (used by this module's own tests) and any remote libgit2 can
/// reach without credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitCredentials {
    None,
    UserPassToken { username: String, token: String },
    SshKey { private_key_path: std::path::PathBuf, passphrase: Option<String> },
}

impl GitCredentials {
    fn callback(&self) -> impl Fn(&str, Option<&str>, git2::CredentialType) -> std::result::Result<Cred, git2::Error> + '_ {
        move |_url, username_from_url, _allowed_types| match self {
            GitCredentials::None => Cred::default(),
            GitCredentials::UserPassToken { username, token } => Cred::userpass_plaintext(username, token),
            GitCredentials::SshKey { private_key_path, passphrase } => Cred::ssh_key(
                username_from_url.unwrap_or("git"),
                None,
                private_key_path,
                passphrase.as_deref(),
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: FileChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MergeOutcome {
    UpToDate,
    FastForwarded,
    Merged,
    Conflicts { paths: Vec<String> },
}

const GITIGNORE_ENTRIES: &[&str] = &[".nodus/history/", ".nodus/index.db", ".nodus/cache/"];

pub struct GitSync {
    repo: Repository,
}

impl GitSync {
    pub fn init_or_open(vault_root: &Path) -> Result<Self> {
        let repo = match Repository::open(vault_root) {
            Ok(repo) => repo,
            Err(_) => {
                // Pin the initial branch name explicitly rather than
                // inheriting whatever `init.defaultBranch` happens to be
                // configured locally — the rest of this module always
                // works with a caller-supplied branch name, so it must be
                // predictable.
                let mut opts = git2::RepositoryInitOptions::new();
                opts.initial_head("main");
                Repository::init_opts(vault_root, &opts)?
            }
        };
        Ok(Self { repo })
    }

    pub fn path(&self) -> &Path {
        self.repo.workdir().unwrap_or_else(|| self.repo.path())
    }

    /// Adds the derived-data folders to `.gitignore` if they aren't already
    /// listed — notes and settings are what should sync, not the search
    /// index, history snapshots, or other caches rebuildable from the notes
    /// themselves.
    pub fn ensure_gitignore(&self) -> Result<()> {
        let path = self.path().join(".gitignore");
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let missing: Vec<&str> = GITIGNORE_ENTRIES
            .iter()
            .filter(|entry| !existing.lines().any(|line| line.trim() == **entry))
            .copied()
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        let mut updated = existing;
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        for entry in missing {
            updated.push_str(entry);
            updated.push('\n');
        }
        std::fs::write(&path, updated)?;
        Ok(())
    }

    /// Every changed path since the last commit, for the status panel.
    pub fn status(&self) -> Result<Vec<FileChange>> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true);
        let statuses = self.repo.statuses(Some(&mut opts))?;
        let mut changes = Vec::new();
        for entry in statuses.iter() {
            let Some(path) = entry.path().ok() else { continue };
            let status = entry.status();
            let kind = if status.intersects(Status::WT_NEW | Status::INDEX_NEW) {
                FileChangeKind::Added
            } else if status.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
                FileChangeKind::Deleted
            } else if status.intersects(Status::WT_RENAMED | Status::INDEX_RENAMED) {
                FileChangeKind::Renamed
            } else {
                FileChangeKind::Modified
            };
            changes.push(FileChange { path: path.to_string(), kind });
        }
        Ok(changes)
    }

    /// Stages every change and commits, unless there's nothing to commit
    /// (returns `Ok(None)` then, rather than an empty commit).
    pub fn commit_all(&self, message: &str, author_name: &str, author_email: &str) -> Result<Option<git2::Oid>> {
        let mut index = self.repo.index()?;
        index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"], None)?; // also stage deletions of tracked files
        index.write()?;

        let tree_oid = index.write_tree()?;
        let parent = self.repo.head().ok().and_then(|h| h.peel_to_commit().ok());

        if let Some(parent) = &parent {
            if parent.tree_id() == tree_oid {
                return Ok(None); // nothing changed
            }
        }

        let tree = self.repo.find_tree(tree_oid)?;
        let signature = Signature::now(author_name, author_email)?;
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        let oid = self.repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &parents)?;
        Ok(Some(oid))
    }

    fn remote_callbacks(credentials: &GitCredentials) -> RemoteCallbacks<'_> {
        let mut callbacks = RemoteCallbacks::new();
        let cred_fn = credentials.callback();
        callbacks.credentials(move |url, username, allowed| cred_fn(url, username, allowed));
        callbacks
    }

    pub fn fetch(&self, remote_name: &str, branch: &str, credentials: &GitCredentials) -> Result<()> {
        let mut remote = self.repo.find_remote(remote_name).or_else(|_| {
            // Only reachable if the caller passes a name with no configured
            // URL yet — real setup always configures the remote first.
            Err(git2::Error::from_str("remote not configured"))
        })?;
        let mut fetch_options = FetchOptions::new();
        fetch_options.remote_callbacks(Self::remote_callbacks(credentials));
        fetch_options.download_tags(AutotagOption::None);
        remote.fetch(&[branch], Some(&mut fetch_options), None)?;
        Ok(())
    }

    /// Merges whatever `fetch` just pulled down into the current branch.
    /// Fast-forwards when possible, merges cleanly when it can, and — when
    /// it can't — leaves the repository in Git's normal "merging" state
    /// with the conflicted paths listed, ready for
    /// [`GitSync::conflict_segments`] / [`GitSync::finalize_resolved_merge`].
    pub fn merge_after_fetch(&self, branch: &str) -> Result<MergeOutcome> {
        let fetch_head = self.repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = self.repo.reference_to_annotated_commit(&fetch_head)?;
        let (analysis, _preference) = self.repo.merge_analysis(&[&fetch_commit])?;

        if analysis.is_up_to_date() {
            return Ok(MergeOutcome::UpToDate);
        }

        if analysis.is_fast_forward() {
            let refname = format!("refs/heads/{branch}");
            // `reference()` creates the branch ref if this is the first
            // thing ever pulled into a fresh repo (no local commits yet, so
            // no local branch ref exists), or fast-forwards it in place if
            // it does — one call handles both, rather than requiring the
            // caller to already know which case they're in.
            self.repo.reference(&refname, fetch_commit.id(), true, "fast-forward")?;
            self.repo.set_head(&refname)?;
            self.repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))?;
            return Ok(MergeOutcome::FastForwarded);
        }

        let mut merge_opts = MergeOptions::new();
        self.repo.merge(&[&fetch_commit], Some(&mut merge_opts), None)?;

        let index = self.repo.index()?;
        if index.has_conflicts() {
            let mut paths = Vec::new();
            for conflict in index.conflicts()? {
                let conflict = conflict?;
                if let Some(entry) = conflict.our.or(conflict.their).or(conflict.ancestor) {
                    paths.push(String::from_utf8_lossy(&entry.path).into_owned());
                }
            }
            paths.sort();
            paths.dedup();
            return Ok(MergeOutcome::Conflicts { paths });
        }

        drop(index);
        self.finish_merge_commit(branch)?;
        Ok(MergeOutcome::Merged)
    }

    fn finish_merge_commit(&self, branch: &str) -> Result<()> {
        let mut index = self.repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = self.repo.find_tree(tree_oid)?;

        let head_commit = self.repo.head()?.peel_to_commit()?;
        let fetch_head = self.repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = self.repo.reference_to_annotated_commit(&fetch_head)?;
        let their_commit = self.repo.find_commit(fetch_commit.id())?;

        let signature = self.repo.signature().unwrap_or(Signature::now("Nodus", "sync@nodus.local")?);
        let refname = format!("refs/heads/{branch}");
        self.repo.commit(
            Some(&refname),
            &signature,
            &signature,
            "Merge",
            &tree,
            &[&head_commit, &their_commit],
        )?;
        self.repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))?;
        self.repo.cleanup_state()?;
        Ok(())
    }

    /// The marker-annotated 3-way merge text for one conflicted path,
    /// parsed into segments the UI compares side by side. Call only while
    /// [`GitSync::merge_after_fetch`] has returned `Conflicts`.
    pub fn conflict_segments(&self, path: &str) -> Result<Vec<MergeSegment>> {
        let index = self.repo.index()?;
        for conflict in index.conflicts()? {
            let conflict = conflict?;
            let matches_path = [&conflict.ancestor, &conflict.our, &conflict.their]
                .iter()
                .any(|e| e.as_ref().map(|e| e.path == path.as_bytes()).unwrap_or(false));
            if !matches_path {
                continue;
            }
            let load = |entry: &Option<git2::IndexEntry>| -> Result<Vec<u8>> {
                match entry {
                    Some(e) => Ok(self.repo.find_blob(e.id)?.content().to_vec()),
                    None => Ok(Vec::new()),
                }
            };
            let ancestor = load(&conflict.ancestor)?;
            let ours = load(&conflict.our)?;
            let theirs = load(&conflict.their)?;

            let mut ancestor_input = git2::MergeFileInput::new();
            ancestor_input.content(&ancestor);
            let mut ours_input = git2::MergeFileInput::new();
            ours_input.content(&ours);
            let mut theirs_input = git2::MergeFileInput::new();
            theirs_input.content(&theirs);

            let result = git2::merge_file(&ancestor_input, &ours_input, &theirs_input, None)?;
            let merged_text = String::from_utf8_lossy(result.content()).into_owned();
            return Ok(conflict::parse_conflict_markers(&merged_text));
        }
        Err(GitError::NotConflicted(path.to_string()))
    }

    /// Writes every resolved file, stages the resolution, and finishes the
    /// merge commit — a restore point of its own, since the merge commit
    /// records exactly what was chosen.
    pub fn finalize_resolved_merge(
        &self,
        branch: &str,
        resolutions: &HashMap<String, String>,
    ) -> Result<()> {
        {
            let index = self.repo.index()?;
            if !index.has_conflicts() {
                return Err(GitError::NotMerging);
            }
        }
        for (path, content) in resolutions {
            let full_path = self.path().join(path);
            if let Some(parent) = full_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&full_path, content)?;
            let mut index = self.repo.index()?;
            index.add_path(Path::new(path))?;
            index.write()?;
        }
        self.finish_merge_commit(branch)
    }

    pub fn push(&self, remote_name: &str, branch: &str, credentials: &GitCredentials) -> Result<()> {
        let mut remote = self.repo.find_remote(remote_name)?;
        let mut push_options = PushOptions::new();
        push_options.remote_callbacks(Self::remote_callbacks(credentials));
        let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
        remote.push(&[refspec.as_str()], Some(&mut push_options))?;
        Ok(())
    }

    pub fn add_remote(&self, name: &str, url: &str) -> Result<()> {
        if self.repo.find_remote(name).is_err() {
            self.repo.remote(name, url)?;
        } else {
            self.repo.remote_set_url(name, url)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

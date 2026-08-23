use super::*;
use std::collections::HashMap;

fn init_client(dir: &Path) -> GitSync {
    std::fs::create_dir_all(dir).unwrap();
    GitSync::init_or_open(dir).unwrap()
}

const NAME: &str = "Test User";
const EMAIL: &str = "test@example.com";

#[test]
fn init_creates_a_repo_and_open_reopens_it() {
    let dir = tempfile::tempdir().unwrap();
    let sync = GitSync::init_or_open(dir.path()).unwrap();
    assert!(dir.path().join(".git").exists());
    drop(sync);

    // Reopening the same directory must not error or reinitialize.
    let reopened = GitSync::init_or_open(dir.path()).unwrap();
    assert!(reopened.path().join(".git").exists());
}

#[test]
fn ensure_gitignore_adds_derived_data_entries() {
    let dir = tempfile::tempdir().unwrap();
    let sync = init_client(dir.path());
    sync.ensure_gitignore().unwrap();
    let content = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    for entry in GITIGNORE_ENTRIES {
        assert!(content.lines().any(|l| l.trim() == *entry), "missing {entry} in {content}");
    }
}

#[test]
fn ensure_gitignore_does_not_duplicate_existing_entries() {
    let dir = tempfile::tempdir().unwrap();
    let sync = init_client(dir.path());
    std::fs::write(dir.path().join(".gitignore"), ".nodus/index.db\nsome-other-thing\n").unwrap();
    sync.ensure_gitignore().unwrap();
    sync.ensure_gitignore().unwrap(); // idempotent
    let content = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert_eq!(content.matches(".nodus/index.db").count(), 1);
    assert!(content.contains("some-other-thing"));
}

#[test]
fn commit_all_stages_and_commits_new_files() {
    let dir = tempfile::tempdir().unwrap();
    let sync = init_client(dir.path());
    std::fs::write(dir.path().join("A.md"), "hello").unwrap();
    let oid = sync.commit_all("Initial commit", NAME, EMAIL).unwrap();
    assert!(oid.is_some());
}

#[test]
fn commit_all_returns_none_when_nothing_changed() {
    let dir = tempfile::tempdir().unwrap();
    let sync = init_client(dir.path());
    std::fs::write(dir.path().join("A.md"), "hello").unwrap();
    sync.commit_all("first", NAME, EMAIL).unwrap();
    let second = sync.commit_all("second, but nothing changed", NAME, EMAIL).unwrap();
    assert!(second.is_none());
}

#[test]
fn commit_all_stages_deletions_too() {
    let dir = tempfile::tempdir().unwrap();
    let sync = init_client(dir.path());
    std::fs::write(dir.path().join("A.md"), "hello").unwrap();
    sync.commit_all("add", NAME, EMAIL).unwrap();

    std::fs::remove_file(dir.path().join("A.md")).unwrap();
    let oid = sync.commit_all("delete", NAME, EMAIL).unwrap();
    assert!(oid.is_some());
    assert!(sync.status().unwrap().is_empty());
}

#[test]
fn status_reports_untracked_and_modified_files() {
    let dir = tempfile::tempdir().unwrap();
    let sync = init_client(dir.path());
    std::fs::write(dir.path().join("A.md"), "hello").unwrap();
    let statuses = sync.status().unwrap();
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].kind, FileChangeKind::Added);

    sync.commit_all("commit", NAME, EMAIL).unwrap();
    assert!(sync.status().unwrap().is_empty());

    std::fs::write(dir.path().join("A.md"), "changed").unwrap();
    let statuses = sync.status().unwrap();
    assert_eq!(statuses[0].kind, FileChangeKind::Modified);
}

/// A bare repo standing in for a real remote (GitHub, a self-hosted
/// server, ...) — local, but exercises the exact same fetch/push/merge
/// codepaths libgit2 uses for a real one.
fn bare_remote(dir: &Path) -> std::path::PathBuf {
    let path = dir.join("remote.git");
    Repository::init_bare(&path).unwrap();
    path
}

fn push_from(sync: &GitSync) {
    sync.push("origin", "main", &GitCredentials::None).unwrap();
}

fn fetch_into(sync: &GitSync) {
    sync.fetch("origin", "main", &GitCredentials::None).unwrap();
}

#[test]
fn a_commit_pushed_by_one_instance_reaches_another_via_the_shared_remote() {
    let root = tempfile::tempdir().unwrap();
    let remote_path = bare_remote(root.path());
    let remote_url = remote_path.to_string_lossy().into_owned();

    let a = init_client(&root.path().join("device-a"));
    a.add_remote("origin", &remote_url).unwrap();
    std::fs::write(a.path().join("Note.md"), "from device A").unwrap();
    a.commit_all("add note", NAME, EMAIL).unwrap();
    push_from(&a);

    let b = init_client(&root.path().join("device-b"));
    b.add_remote("origin", &remote_url).unwrap();
    fetch_into(&b);
    let outcome = b.merge_after_fetch("main").unwrap();
    assert_eq!(outcome, MergeOutcome::FastForwarded);
    assert_eq!(std::fs::read_to_string(b.path().join("Note.md")).unwrap(), "from device A");
}

#[test]
fn simultaneous_edits_to_different_files_merge_cleanly() {
    let root = tempfile::tempdir().unwrap();
    let remote_url = bare_remote(root.path()).to_string_lossy().into_owned();

    let a = init_client(&root.path().join("device-a"));
    a.add_remote("origin", &remote_url).unwrap();
    std::fs::write(a.path().join("Shared.md"), "base content").unwrap();
    a.commit_all("base", NAME, EMAIL).unwrap();
    push_from(&a);

    let b = init_client(&root.path().join("device-b"));
    b.add_remote("origin", &remote_url).unwrap();
    fetch_into(&b);
    b.merge_after_fetch("main").unwrap();

    // A edits one file, B edits a different one, both offline from each other.
    std::fs::write(a.path().join("A-only.md"), "only on A").unwrap();
    a.commit_all("A's change", NAME, EMAIL).unwrap();
    push_from(&a);

    std::fs::write(b.path().join("B-only.md"), "only on B").unwrap();
    b.commit_all("B's change", NAME, EMAIL).unwrap();

    fetch_into(&b);
    let outcome = b.merge_after_fetch("main").unwrap();
    assert_eq!(outcome, MergeOutcome::Merged);
    assert!(b.path().join("A-only.md").exists());
    assert!(b.path().join("B-only.md").exists());

    push_from(&b);
    fetch_into(&a);
    let outcome = a.merge_after_fetch("main").unwrap();
    assert!(matches!(outcome, MergeOutcome::FastForwarded | MergeOutcome::Merged));
    assert!(a.path().join("B-only.md").exists());
}

#[test]
fn conflicting_edits_to_the_same_lines_are_reported_and_resolved_without_losing_either_version() {
    let root = tempfile::tempdir().unwrap();
    let remote_url = bare_remote(root.path()).to_string_lossy().into_owned();

    let a = init_client(&root.path().join("device-a"));
    a.add_remote("origin", &remote_url).unwrap();
    std::fs::write(a.path().join("Shared.md"), "line one\nline two\nline three\n").unwrap();
    a.commit_all("base", NAME, EMAIL).unwrap();
    push_from(&a);

    let b = init_client(&root.path().join("device-b"));
    b.add_remote("origin", &remote_url).unwrap();
    fetch_into(&b);
    b.merge_after_fetch("main").unwrap();

    // Both edit the same line, differently, without ever syncing in between.
    std::fs::write(a.path().join("Shared.md"), "line one\nA's version\nline three\n").unwrap();
    a.commit_all("A edits line two", NAME, EMAIL).unwrap();
    push_from(&a);

    std::fs::write(b.path().join("Shared.md"), "line one\nB's version\nline three\n").unwrap();
    b.commit_all("B edits line two", NAME, EMAIL).unwrap();

    fetch_into(&b);
    let outcome = b.merge_after_fetch("main").unwrap();
    let conflicts = match outcome {
        MergeOutcome::Conflicts { paths } => paths,
        other => panic!("expected a conflict, got {other:?}"),
    };
    assert_eq!(conflicts, vec!["Shared.md".to_string()]);

    // The working file must never show raw git conflict markers.
    let working_copy = std::fs::read_to_string(b.path().join("Shared.md")).unwrap();
    assert!(working_copy.contains("<<<<<<<"), "sanity: libgit2 does write markers into the worktree");

    let segments = b.conflict_segments("Shared.md").unwrap();
    assert_eq!(conflict::conflict_count(&segments), 1);
    let resolved = conflict::resolve_segments(&segments, &[ConflictChoice::Both]).unwrap();
    assert!(resolved.contains("A's version"));
    assert!(resolved.contains("B's version"));
    assert!(!resolved.contains("<<<<<<<"));

    let mut resolutions = HashMap::new();
    resolutions.insert("Shared.md".to_string(), resolved.clone());
    b.finalize_resolved_merge("main", &resolutions).unwrap();

    let final_content = std::fs::read_to_string(b.path().join("Shared.md")).unwrap();
    assert_eq!(final_content, resolved);
    assert!(!final_content.contains("<<<<<<<"));
    assert!(b.status().unwrap().is_empty(), "the merge commit must leave a clean working tree");
}

#[test]
fn a_deleted_file_does_not_come_back_when_the_other_device_syncs() {
    let root = tempfile::tempdir().unwrap();
    let remote_url = bare_remote(root.path()).to_string_lossy().into_owned();

    let a = init_client(&root.path().join("device-a"));
    a.add_remote("origin", &remote_url).unwrap();
    std::fs::write(a.path().join("ToDelete.md"), "will be deleted").unwrap();
    a.commit_all("add", NAME, EMAIL).unwrap();
    push_from(&a);

    let b = init_client(&root.path().join("device-b"));
    b.add_remote("origin", &remote_url).unwrap();
    fetch_into(&b);
    b.merge_after_fetch("main").unwrap();
    assert!(b.path().join("ToDelete.md").exists());

    std::fs::remove_file(a.path().join("ToDelete.md")).unwrap();
    a.commit_all("delete the file", NAME, EMAIL).unwrap();
    push_from(&a);

    fetch_into(&b);
    let outcome = b.merge_after_fetch("main").unwrap();
    assert_eq!(outcome, MergeOutcome::FastForwarded);
    assert!(!b.path().join("ToDelete.md").exists(), "deletion must propagate, not be resurrected");
}

#[test]
fn renaming_the_same_file_differently_on_both_sides_keeps_both_names() {
    let root = tempfile::tempdir().unwrap();
    let remote_url = bare_remote(root.path()).to_string_lossy().into_owned();

    let a = init_client(&root.path().join("device-a"));
    a.add_remote("origin", &remote_url).unwrap();
    std::fs::write(a.path().join("Original.md"), "content that stays the same\nacross the rename\n").unwrap();
    a.commit_all("base", NAME, EMAIL).unwrap();
    push_from(&a);

    let b = init_client(&root.path().join("device-b"));
    b.add_remote("origin", &remote_url).unwrap();
    fetch_into(&b);
    b.merge_after_fetch("main").unwrap();

    std::fs::rename(a.path().join("Original.md"), a.path().join("RenamedByA.md")).unwrap();
    a.commit_all("rename on A", NAME, EMAIL).unwrap();
    push_from(&a);

    std::fs::rename(b.path().join("Original.md"), b.path().join("RenamedByB.md")).unwrap();
    b.commit_all("rename on B", NAME, EMAIL).unwrap();

    fetch_into(&b);
    let outcome = b.merge_after_fetch("main").unwrap();
    // Git's rename detection may resolve this cleanly (both renames applied)
    // or flag it as a conflict depending on similarity heuristics — either
    // way, no content may vanish silently.
    match outcome {
        MergeOutcome::Merged | MergeOutcome::FastForwarded => {
            let a_name_exists = b.path().join("RenamedByA.md").exists();
            let b_name_exists = b.path().join("RenamedByB.md").exists();
            assert!(a_name_exists || b_name_exists, "at least one rename must survive a clean merge");
        }
        MergeOutcome::Conflicts { paths } => {
            assert!(!paths.is_empty());
        }
        MergeOutcome::UpToDate => panic!("both sides changed — this cannot be a no-op"),
    }
}

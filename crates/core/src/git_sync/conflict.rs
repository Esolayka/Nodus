//! Turning libgit2's standard `<<<<<<<`/`=======`/`>>>>>>>` merge output
//! into a structured form the UI can render as a real comparison — and
//! back into plain text once the user has picked a resolution for every
//! conflicting hunk. The raw marker text itself is never what gets written
//! to a note file; it only ever exists as an intermediate value in memory.

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MergeSegment {
    /// A stretch where both sides agree (or only one side changed it) —
    /// libgit2 already merged this part cleanly.
    Clean { text: String },
    /// A hunk both sides changed differently. `mine`/`theirs` are the two
    /// versions of just this hunk, never the whole file.
    Conflict { mine: String, theirs: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictChoice {
    Mine,
    Theirs,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum State {
    Clean,
    Mine,
    Theirs,
}

/// Parses libgit2's marker-annotated merge output into segments. Never
/// fails: markers that don't line up correctly (a `=======` with no
/// preceding `<<<<<<<`, a truncated conflict at EOF, ...) are treated as
/// ordinary content rather than rejected, since this always runs on
/// libgit2's own output, never on a note a user could have typed
/// `<<<<<<<` into by hand.
pub fn parse_conflict_markers(merged: &str) -> Vec<MergeSegment> {
    let mut segments = Vec::new();
    let mut clean_lines: Vec<&str> = Vec::new();
    let mut mine_lines: Vec<&str> = Vec::new();
    let mut theirs_lines: Vec<&str> = Vec::new();
    let mut state = State::Clean;

    for line in merged.split('\n') {
        if line.starts_with("<<<<<<<") && state == State::Clean {
            if !clean_lines.is_empty() {
                segments.push(MergeSegment::Clean {
                    text: clean_lines.join("\n"),
                });
                clean_lines.clear();
            }
            state = State::Mine;
            continue;
        }
        if line.starts_with("=======") && state == State::Mine {
            state = State::Theirs;
            continue;
        }
        if line.starts_with(">>>>>>>") && state == State::Theirs {
            segments.push(MergeSegment::Conflict {
                mine: mine_lines.join("\n"),
                theirs: theirs_lines.join("\n"),
            });
            mine_lines.clear();
            theirs_lines.clear();
            state = State::Clean;
            continue;
        }
        match state {
            State::Clean => clean_lines.push(line),
            State::Mine => mine_lines.push(line),
            State::Theirs => theirs_lines.push(line),
        }
    }

    // An unterminated conflict (shouldn't happen from real libgit2 output,
    // but never crash over it) — fold whatever was collected back in as
    // plain text rather than silently dropping it.
    match state {
        State::Clean => {
            if !clean_lines.is_empty() {
                segments.push(MergeSegment::Clean {
                    text: clean_lines.join("\n"),
                });
            }
        }
        State::Mine => segments.push(MergeSegment::Clean {
            text: mine_lines.join("\n"),
        }),
        State::Theirs => segments.push(MergeSegment::Clean {
            text: theirs_lines.join("\n"),
        }),
    }

    segments
}

/// Rebuilds plain text from parsed segments, given one choice per conflict
/// segment (in the order they appear). `None` if fewer choices were given
/// than there are conflicts — the caller should treat that as "not
/// finished resolving yet", not write anything.
pub fn resolve_segments(segments: &[MergeSegment], choices: &[ConflictChoice]) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    let mut choice_idx = 0;
    for segment in segments {
        match segment {
            MergeSegment::Clean { text } => parts.push(text),
            MergeSegment::Conflict { mine, theirs } => {
                let choice = choices.get(choice_idx)?;
                choice_idx += 1;
                match choice {
                    ConflictChoice::Mine => parts.push(mine),
                    ConflictChoice::Theirs => parts.push(theirs),
                    ConflictChoice::Both => {
                        parts.push(mine);
                        parts.push(theirs);
                    }
                }
            }
        }
    }
    Some(parts.join("\n"))
}

pub fn conflict_count(segments: &[MergeSegment]) -> usize {
    segments
        .iter()
        .filter(|s| matches!(s, MergeSegment::Conflict { .. }))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_markers_is_one_clean_segment() {
        let segments = parse_conflict_markers("line1\nline2\nline3");
        assert_eq!(
            segments,
            vec![MergeSegment::Clean {
                text: "line1\nline2\nline3".to_string()
            }]
        );
    }

    #[test]
    fn single_conflict_hunk_between_clean_text() {
        let merged =
            "line1\n<<<<<<< HEAD\nmine A\nmine B\n=======\ntheirs A\n>>>>>>> branch\nline2";
        let segments = parse_conflict_markers(merged);
        assert_eq!(
            segments,
            vec![
                MergeSegment::Clean {
                    text: "line1".to_string()
                },
                MergeSegment::Conflict {
                    mine: "mine A\nmine B".to_string(),
                    theirs: "theirs A".to_string()
                },
                MergeSegment::Clean {
                    text: "line2".to_string()
                },
            ]
        );
    }

    #[test]
    fn conflict_with_no_leading_clean_text() {
        let merged = "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> branch\nafter";
        let segments = parse_conflict_markers(merged);
        assert_eq!(
            segments,
            vec![
                MergeSegment::Conflict {
                    mine: "mine".to_string(),
                    theirs: "theirs".to_string()
                },
                MergeSegment::Clean {
                    text: "after".to_string()
                },
            ]
        );
    }

    #[test]
    fn multiple_conflict_hunks_in_one_file() {
        let merged = "a\n<<<<<<< HEAD\nm1\n=======\nt1\n>>>>>>> b\nmid\n<<<<<<< HEAD\nm2\n=======\nt2\n>>>>>>> b\nz";
        let segments = parse_conflict_markers(merged);
        assert_eq!(conflict_count(&segments), 2);
        assert_eq!(segments.len(), 5); // clean, conflict, clean, conflict, clean
    }

    #[test]
    fn resolve_taking_mine() {
        let merged = "before\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> b\nafter";
        let segments = parse_conflict_markers(merged);
        let resolved = resolve_segments(&segments, &[ConflictChoice::Mine]).unwrap();
        assert_eq!(resolved, "before\nmine\nafter");
    }

    #[test]
    fn resolve_taking_theirs() {
        let merged = "before\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> b\nafter";
        let segments = parse_conflict_markers(merged);
        let resolved = resolve_segments(&segments, &[ConflictChoice::Theirs]).unwrap();
        assert_eq!(resolved, "before\ntheirs\nafter");
    }

    #[test]
    fn resolve_taking_both_keeps_mine_then_theirs() {
        let merged = "before\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> b\nafter";
        let segments = parse_conflict_markers(merged);
        let resolved = resolve_segments(&segments, &[ConflictChoice::Both]).unwrap();
        assert_eq!(resolved, "before\nmine\ntheirs\nafter");
    }

    #[test]
    fn resolve_returns_none_when_not_every_conflict_has_a_choice() {
        let merged = "<<<<<<< HEAD\nm1\n=======\nt1\n>>>>>>> b\nmid\n<<<<<<< HEAD\nm2\n=======\nt2\n>>>>>>> b\n";
        let segments = parse_conflict_markers(merged);
        assert!(resolve_segments(&segments, &[ConflictChoice::Mine]).is_none());
    }

    #[test]
    fn resolved_text_never_contains_raw_markers() {
        let merged = "before\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> b\nafter";
        let segments = parse_conflict_markers(merged);
        for choice in [
            ConflictChoice::Mine,
            ConflictChoice::Theirs,
            ConflictChoice::Both,
        ] {
            let resolved = resolve_segments(&segments, &[choice]).unwrap();
            assert!(!resolved.contains("<<<<<<<"));
            assert!(!resolved.contains("======="));
            assert!(!resolved.contains(">>>>>>>"));
        }
    }
}

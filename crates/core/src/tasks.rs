//! Parsing `- [ ]`/`- [x]` checklist items as tasks, plus the optional
//! metadata a task line can carry: a due date (`📅 2026-09-01` or
//! `due:: 2026-09-01`), a priority (`⏫`/`🔼`/`🔽` or `!`/`!!`/`!!!`), a
//! completion date (`✅ 2026-09-01`), and a repeat rule (`🔁 every week`) —
//! all optional. A line with none of them is still a perfectly ordinary
//! task; nothing here requires the metadata to be present.

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Low = 1,
    Medium = 2,
    High = 3,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskOccurrence {
    /// 1-indexed line number.
    pub line: usize,
    pub done: bool,
    /// Display text: the checklist item's text with recognized metadata
    /// tokens stripped out, so the panel doesn't repeat the due-date emoji
    /// a second time next to its own "due" column.
    pub text: String,
    pub due: Option<String>,
    pub priority: Option<Priority>,
    pub completed: Option<String>,
    pub repeat: Option<String>,
    /// Byte range of the checkbox marker (`[ ]` or `[x]`, brackets
    /// included) — for toggling in place.
    pub marker_start: usize,
    pub marker_end: usize,
}

const DUE_EMOJI: char = '📅';
const DONE_EMOJI: char = '✅';
const REPEAT_EMOJI: char = '🔁';

fn parse_checkbox_line(line: &str, line_start: usize) -> Option<(bool, usize, usize, &str)> {
    let trimmed_start = line.len() - line.trim_start().len();
    let rest = &line[trimmed_start..];
    let dash = rest
        .strip_prefix("- ")
        .or_else(|| rest.strip_prefix("* "))
        .or_else(|| rest.strip_prefix("+ "))?;
    let dash_len = rest.len() - dash.len();
    let bracket_open = dash.strip_prefix('[')?;
    let mark = bracket_open.chars().next()?;
    let bracket_close = &bracket_open[mark.len_utf8()..];
    let after_bracket = bracket_close.strip_prefix(']')?;
    if !after_bracket.is_empty() && !after_bracket.starts_with(' ') {
        return None;
    }
    let done = mark == 'x' || mark == 'X';
    let marker_rel_start = trimmed_start + dash_len;
    let marker_rel_end = marker_rel_start + 1 + mark.len_utf8() + 1;
    let text = after_bracket.trim_start();
    Some((
        done,
        line_start + marker_rel_start,
        line_start + marker_rel_end,
        text,
    ))
}

fn extract_date_after(text: &str, marker: &str) -> Option<(String, usize, usize)> {
    let idx = text.find(marker)?;
    let after = &text[idx + marker.len()..];
    let after_trimmed = after.trim_start();
    let skip = after.len() - after_trimmed.len();
    let date: String = after_trimmed
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect();
    if date.len() < 8 {
        return None;
    }
    let start = idx;
    let end = idx + marker.len() + skip + date.len();
    Some((date, start, end))
}

fn strip_range(text: &mut String, start: usize, end: usize) {
    text.replace_range(start..end, "");
}

/// Parses one task line's metadata and returns the cleaned display text —
/// pure text processing, no byte-offset bookkeeping (that's handled by the
/// caller, which has the line's absolute position).
struct ParsedMeta {
    text: String,
    due: Option<String>,
    priority: Option<Priority>,
    completed: Option<String>,
    repeat: Option<String>,
}

fn parse_metadata(raw_text: &str) -> ParsedMeta {
    let mut text = raw_text.to_string();
    let mut due = None;
    let mut completed = None;

    if let Some((date, s, e)) = extract_date_after(&text, &DUE_EMOJI.to_string()) {
        due = Some(date);
        strip_range(&mut text, s, e);
    } else if let Some((date, s, e)) = extract_date_after(&text, "due::") {
        due = Some(date);
        strip_range(&mut text, s, e);
    }

    if let Some((date, s, e)) = extract_date_after(&text, &DONE_EMOJI.to_string()) {
        completed = Some(date);
        strip_range(&mut text, s, e);
    }

    let mut repeat = None;
    if let Some(idx) = text.find(REPEAT_EMOJI) {
        let after = text[idx + REPEAT_EMOJI.len_utf8()..].trim_start();
        // Repeat text runs to the next recognized token or end of line.
        let end_rel = after
            .find(['📅', '✅', '⏫', '🔼', '🔽'])
            .unwrap_or(after.len());
        let repeat_text = after[..end_rel].trim().to_string();
        let start = idx;
        let end = idx
            + REPEAT_EMOJI.len_utf8()
            + (text[idx + REPEAT_EMOJI.len_utf8()..].len() - after.len())
            + end_rel;
        if !repeat_text.is_empty() {
            repeat = Some(repeat_text);
        }
        let clamped_end = end.min(text.len());
        strip_range(&mut text, start, clamped_end);
    }

    let mut priority = None;
    for (token, p) in [
        ("⏫", Priority::High),
        ("🔼", Priority::Medium),
        ("🔽", Priority::Low),
    ] {
        if let Some(idx) = text.find(token) {
            priority = Some(p);
            strip_range(&mut text, idx, idx + token.len());
            break;
        }
    }
    if priority.is_none() {
        for (token, p) in [
            ("!!!", Priority::High),
            ("!!", Priority::Medium),
            ("!", Priority::Low),
        ] {
            if let Some(idx) = text.find(token) {
                // Only a standalone `!`-style marker, not punctuation inside a sentence:
                // require it to be preceded by whitespace or start-of-text.
                let ok_before = idx == 0 || text.as_bytes()[idx - 1] == b' ';
                let after_idx = idx + token.len();
                let ok_after = after_idx >= text.len() || text.as_bytes()[after_idx] == b' ';
                if ok_before && ok_after {
                    priority = Some(p);
                    strip_range(&mut text, idx, after_idx);
                    break;
                }
            }
        }
    }

    ParsedMeta {
        text: text.split_whitespace().collect::<Vec<_>>().join(" "),
        due,
        priority,
        completed,
        repeat,
    }
}

enum RepeatUnit {
    Day,
    Week,
    Month,
    Year,
}

fn parse_repeat_unit(word: &str) -> Option<RepeatUnit> {
    match word {
        "day" | "days" | "daily" | "день" | "дня" | "дней" | "ежедневно" => {
            Some(RepeatUnit::Day)
        }
        "week" | "weeks" | "weekly" | "неделю" | "недели" | "недель" | "еженедельно" => {
            Some(RepeatUnit::Week)
        }
        "month" | "months" | "monthly" | "месяц" | "месяца" | "месяцев" | "ежемесячно" => {
            Some(RepeatUnit::Month)
        }
        "year" | "years" | "yearly" | "annually" | "год" | "года" | "лет" | "ежегодно" => {
            Some(RepeatUnit::Year)
        }
        _ => None,
    }
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    use chrono::{Datelike, NaiveDate};
    let next_month_first = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("valid calendar month");
    next_month_first
        .pred_opt()
        .expect("day before a valid date is valid")
        .day()
}

fn add_months(date: chrono::NaiveDate, months: i64) -> chrono::NaiveDate {
    use chrono::{Datelike, NaiveDate};
    let total = date.year() as i64 * 12 + (date.month() as i64 - 1) + months;
    let year = total.div_euclid(12) as i32;
    let month = total.rem_euclid(12) as u32 + 1;
    let day = date.day().min(last_day_of_month(year, month));
    NaiveDate::from_ymd_opt(year, month, day).expect("clamped day is valid for its month")
}

/// Given a task's current due date (`YYYY-MM-DD`, or none) and its free-text
/// repeat rule (`every week`, `2 months`, `ежедневно`, ...), works out the
/// next occurrence's due date. Recognizes an optional leading count and a
/// day/week/month/year unit in either English or Russian; anything else
/// (an unrecognized phrase) yields `None` rather than guessing — the task
/// still gets marked done, it just doesn't spawn a next occurrence.
pub fn compute_next_due(
    current_due: Option<&str>,
    repeat_text: &str,
    today: chrono::NaiveDate,
) -> Option<String> {
    use chrono::{Duration, NaiveDate};

    let base = current_due
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .unwrap_or(today);

    let lower = repeat_text.to_lowercase();
    let mut count: i64 = 1;
    let mut unit = None;
    for word in lower.split_whitespace() {
        if let Ok(n) = word.parse::<i64>() {
            count = n;
        } else if let Some(u) = parse_repeat_unit(word) {
            unit = Some(u);
        }
    }
    let unit = unit?;

    let next = match unit {
        RepeatUnit::Day => base + Duration::days(count),
        RepeatUnit::Week => base + Duration::weeks(count),
        RepeatUnit::Month => add_months(base, count),
        RepeatUnit::Year => add_months(base, count * 12),
    };
    Some(next.format("%Y-%m-%d").to_string())
}

/// Builds the next occurrence's line for a recurring task: same line as
/// `original_line` (still unchecked — this runs on the pre-toggle text) with
/// its due date swapped for `next_due`, or a due date appended if it didn't
/// have one yet.
pub fn build_recurring_line(
    original_line: &str,
    current_due: Option<&str>,
    next_due: &str,
) -> String {
    match current_due {
        Some(old_due) => original_line.replacen(old_due, next_due, 1),
        None => format!("{original_line} {DUE_EMOJI} {next_due}"),
    }
}

pub fn find_tasks(content: &str) -> Vec<TaskOccurrence> {
    let mut tasks = Vec::new();
    let mut pos = 0usize;
    for (i, line) in content.split('\n').enumerate() {
        if let Some((done, marker_start, marker_end, raw_text)) = parse_checkbox_line(line, pos) {
            let meta = parse_metadata(raw_text);
            tasks.push(TaskOccurrence {
                line: i + 1,
                done,
                text: meta.text,
                due: meta.due,
                priority: meta.priority,
                completed: meta.completed,
                repeat: meta.repeat,
                marker_start,
                marker_end,
            });
        }
        pos += line.len() + 1;
    }
    tasks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_plain_checklist_task() {
        let tasks = find_tasks("- [ ] Buy milk\n- [x] Done thing\n");
        assert_eq!(tasks.len(), 2);
        assert!(!tasks[0].done);
        assert_eq!(tasks[0].text, "Buy milk");
        assert!(tasks[1].done);
        assert_eq!(tasks[1].text, "Done thing");
    }

    #[test]
    fn parses_due_date_emoji() {
        let tasks = find_tasks("- [ ] Ship it 📅 2026-09-01\n");
        assert_eq!(tasks[0].due.as_deref(), Some("2026-09-01"));
        assert_eq!(tasks[0].text, "Ship it");
    }

    #[test]
    fn parses_due_date_dataview_style() {
        let tasks = find_tasks("- [ ] Ship it due:: 2026-09-01\n");
        assert_eq!(tasks[0].due.as_deref(), Some("2026-09-01"));
        assert_eq!(tasks[0].text, "Ship it");
    }

    #[test]
    fn parses_priority_emoji() {
        let tasks =
            find_tasks("- [ ] Urgent ⏫ thing\n- [ ] Medium 🔼 thing\n- [ ] Low 🔽 thing\n");
        assert_eq!(tasks[0].priority, Some(Priority::High));
        assert_eq!(tasks[1].priority, Some(Priority::Medium));
        assert_eq!(tasks[2].priority, Some(Priority::Low));
        assert_eq!(tasks[0].text, "Urgent thing");
    }

    #[test]
    fn parses_priority_bang_style() {
        let tasks =
            find_tasks("- [ ] !!! Urgent thing\n- [ ] !! Medium thing\n- [ ] ! Low thing\n");
        assert_eq!(tasks[0].priority, Some(Priority::High));
        assert_eq!(tasks[1].priority, Some(Priority::Medium));
        assert_eq!(tasks[2].priority, Some(Priority::Low));
    }

    #[test]
    fn does_not_mistake_exclamation_in_prose_for_priority() {
        let tasks = find_tasks("- [ ] Wow! This is exciting!\n");
        assert_eq!(tasks[0].priority, None);
        assert_eq!(tasks[0].text, "Wow! This is exciting!");
    }

    #[test]
    fn parses_completion_date() {
        let tasks = find_tasks("- [x] Done thing ✅ 2026-09-01\n");
        assert_eq!(tasks[0].completed.as_deref(), Some("2026-09-01"));
        assert_eq!(tasks[0].text, "Done thing");
    }

    #[test]
    fn parses_repeat_marker() {
        let tasks = find_tasks("- [ ] Water plants 🔁 every week\n");
        assert_eq!(tasks[0].repeat.as_deref(), Some("every week"));
        assert_eq!(tasks[0].text, "Water plants");
    }

    #[test]
    fn plain_checklist_with_no_metadata_still_works() {
        let tasks = find_tasks("- [ ] Just a normal task, nothing fancy.\n");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].due, None);
        assert_eq!(tasks[0].priority, None);
        assert_eq!(tasks[0].text, "Just a normal task, nothing fancy.");
    }

    #[test]
    fn marker_range_points_at_brackets_for_toggling() {
        let content = "- [ ] Task\n";
        let tasks = find_tasks(content);
        let (s, e) = (tasks[0].marker_start, tasks[0].marker_end);
        assert_eq!(&content[s..e], "[ ]");
    }

    #[test]
    fn ignores_non_task_list_items() {
        let tasks = find_tasks("- Just a bullet\n- [ ] A real task\n");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "A real task");
    }

    #[test]
    fn computes_next_due_for_weekly_repeat() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
        let next = compute_next_due(Some("2026-09-01"), "every week", today);
        assert_eq!(next.as_deref(), Some("2026-09-08"));
    }

    #[test]
    fn computes_next_due_for_russian_weekly_repeat() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
        let next = compute_next_due(None, "каждую неделю", today);
        assert_eq!(next.as_deref(), Some("2026-09-08"));
    }

    #[test]
    fn computes_next_due_with_a_count_and_month_unit_clamped_to_month_end() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        let next = compute_next_due(Some("2026-01-31"), "1 month", today);
        // February has no 31st, so it clamps to the last day of February.
        assert_eq!(next.as_deref(), Some("2026-02-28"));
    }

    #[test]
    fn unrecognized_repeat_phrase_yields_no_next_due() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
        assert_eq!(
            compute_next_due(Some("2026-09-01"), "someday maybe", today),
            None
        );
    }

    #[test]
    fn recurring_line_swaps_existing_due_date() {
        let line = "- [ ] Water plants 📅 2026-09-01 🔁 every week";
        let next = build_recurring_line(line, Some("2026-09-01"), "2026-09-08");
        assert_eq!(next, "- [ ] Water plants 📅 2026-09-08 🔁 every week");
    }

    #[test]
    fn recurring_line_appends_due_date_when_absent() {
        let line = "- [ ] Water plants 🔁 every week";
        let next = build_recurring_line(line, None, "2026-09-08");
        assert_eq!(next, "- [ ] Water plants 🔁 every week 📅 2026-09-08");
    }

    #[test]
    fn combines_due_priority_and_repeat_together() {
        let tasks = find_tasks("- [ ] Standup ⏫ 📅 2026-09-01 🔁 every day\n");
        assert_eq!(tasks[0].priority, Some(Priority::High));
        assert_eq!(tasks[0].due.as_deref(), Some("2026-09-01"));
        assert_eq!(tasks[0].repeat.as_deref(), Some("every day"));
        assert_eq!(tasks[0].text, "Standup");
    }
}

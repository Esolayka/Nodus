import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dailyNotePath, dateOfDailyNote, openDailyNote } from "../../lib/dailyNotes";
import { isSameDay } from "../../lib/dateFormat";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import "./CalendarPanel.css";

interface DayCell {
  date: Date;
  inMonth: boolean;
}

function buildGrid(viewMonth: Date): DayCell[] {
  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  // Monday-first week: JS getDay() is 0=Sunday, shift so Monday is 0.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - leadingBlanks);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart);
    date.setDate(date.getDate() + i);
    cells.push({ date, inMonth: date.getMonth() === viewMonth.getMonth() });
  }
  return cells;
}

export function CalendarPanel() {
  const { t, i18n } = useTranslation();
  const tree = useVaultStore((s) => s.tree);
  const noteIndex = useVaultStore((s) => s.noteIndex);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const activePath = useWorkspaceStore((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    return pane?.activePath ?? null;
  });

  const datesWithNotes = useMemo(() => {
    const set = new Set<string>();
    for (const note of noteIndex.notes) {
      const date = dateOfDailyNote(note.path);
      if (date) set.add(date.toDateString());
    }
    return set;
  }, [noteIndex]);

  const activeDailyDate = activePath ? dateOfDailyNote(activePath) : null;
  const today = new Date();
  const cells = useMemo(() => buildGrid(viewMonth), [viewMonth]);

  const monthLabel = viewMonth.toLocaleDateString(i18n.language, { month: "long", year: "numeric" });
  const weekdayLabels = useMemo(() => {
    // Monday-first weekday abbreviations in the active locale.
    const base = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(i18n.language, { weekday: "narrow" });
    });
  }, [i18n.language]);

  function changeMonth(delta: number) {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  if (!tree) {
    return <p className="side-panel-empty">{t("sidebar.emptyState")}</p>;
  }

  return (
    <div className="calendar-panel">
      <div className="calendar-toolbar">
        <button type="button" className="calendar-nav-btn" onClick={() => changeMonth(-1)} aria-label={t("calendar.prevMonth")}>
          <ChevronLeft size={16} />
        </button>
        <span className="calendar-month-label">{monthLabel}</span>
        <button type="button" className="calendar-nav-btn" onClick={() => changeMonth(1)} aria-label={t("calendar.nextMonth")}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="calendar-weekdays">
        {weekdayLabels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map(({ date, inMonth }) => {
          const hasNote = datesWithNotes.has(date.toDateString());
          const isToday = isSameDay(date, today);
          const isActive = activeDailyDate != null && isSameDay(date, activeDailyDate);
          const classes = [
            "calendar-day",
            !inMonth && "calendar-day-outside",
            isToday && "calendar-day-today",
            isActive && "calendar-day-active",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={date.toISOString()}
              type="button"
              className={classes}
              title={dailyNotePath(date)}
              onClick={() => void openDailyNote(date)}
            >
              {date.getDate()}
              {hasNote && <span className="calendar-day-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

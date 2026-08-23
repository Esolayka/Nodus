/** A small Moment-style token formatter/parser — `YYYY-MM-DD`, `DD.MM.YYYY`,
 * `HH:mm`, etc. Shared by Daily Notes (filename format) and Templates
 * (`{{date:FORMAT}}`/`{{time:FORMAT}}`) so both use the same token set. */

const TOKEN_RE = /YYYY|YY|MM|DD|HH|mm|ss/g;

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

export function formatDate(date: Date, pattern: string): string {
  return pattern.replace(TOKEN_RE, (token) => {
    switch (token) {
      case "YYYY":
        return String(date.getFullYear());
      case "YY":
        return pad(date.getFullYear() % 100);
      case "MM":
        return pad(date.getMonth() + 1);
      case "DD":
        return pad(date.getDate());
      case "HH":
        return pad(date.getHours());
      case "mm":
        return pad(date.getMinutes());
      case "ss":
        return pad(date.getSeconds());
      default:
        return token;
    }
  });
}

export const DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD";

/** Formats most commonly reached for besides the exact configured one — used
 * as a tolerant fallback when parsing filenames back into dates, so
 * switching `filenameFormat` doesn't make older notes vanish from the
 * calendar. */
const FALLBACK_DATE_FORMATS = [
  DEFAULT_DAILY_NOTE_FORMAT,
  "DD.MM.YYYY",
  "DD-MM-YYYY",
  "YYYY.MM.DD",
  "MM-DD-YYYY",
  "MM/DD/YYYY",
];

type DatePart = "Y" | "M" | "D";

function patternToRegex(pattern: string): { regex: RegExp; order: DatePart[] } {
  const order: DatePart[] = [];
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const rest = pattern.slice(i);
    if (rest.startsWith("YYYY")) {
      re += "(\\d{4})";
      order.push("Y");
      i += 4;
    } else if (rest.startsWith("YY")) {
      re += "(\\d{2})";
      order.push("Y");
      i += 2;
    } else if (rest.startsWith("MM")) {
      re += "(\\d{2})";
      order.push("M");
      i += 2;
    } else if (rest.startsWith("DD")) {
      re += "(\\d{2})";
      order.push("D");
      i += 2;
    } else {
      re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return { regex: new RegExp(`^${re}$`), order };
}

/** Parses `basename` (no extension) as a date using exactly `pattern`; null
 * if it doesn't structurally match or the resulting date is nonsensical. */
export function parseDateWithFormat(basename: string, pattern: string): Date | null {
  const { regex, order } = patternToRegex(pattern);
  const m = regex.exec(basename);
  if (!m) return null;
  let year = new Date().getFullYear();
  let month = 1;
  let day = 1;
  order.forEach((kind, idx) => {
    const value = Number(m[idx + 1]);
    if (kind === "Y") year = value < 100 ? 2000 + value : value;
    else if (kind === "M") month = value;
    else if (kind === "D") day = value;
  });
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Reject e.g. "2026-02-31" silently rolling over into March.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** Tries `primaryPattern` first, then a handful of common formats — so a
 * note named under a since-changed format still shows up on the calendar
 * instead of quietly disappearing. */
export function parseDateTolerant(basename: string, primaryPattern: string): Date | null {
  const patterns = [primaryPattern, ...FALLBACK_DATE_FORMATS.filter((f) => f !== primaryPattern)];
  for (const pattern of patterns) {
    const date = parseDateWithFormat(basename, pattern);
    if (date) return date;
  }
  return null;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

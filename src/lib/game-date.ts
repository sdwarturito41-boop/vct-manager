/**
 * In-game time uses an absolute day index starting at 1. Each season's day 1
 * is January 1 of that season's calendar year. Day N is therefore Jan 1 +
 * (N-1) days, computed against the real Gregorian calendar — so weekday and
 * month are not the same every season (Jan 1 2026 is a Thursday, Jan 1 2027
 * is a Friday, etc.).
 *
 * Weekly payroll, transfer cooldowns and roster locks all stay anchored on
 * real-calendar Mondays via `dayOfWeek(day, year)`.
 */

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DEFAULT_YEAR = 2026;

/** Day 1 of `year` → Jan 1. Returns a UTC Date so DST never shifts the calendar. */
export function gameDateToCalendar(absoluteDay: number, year: number = DEFAULT_YEAR): Date {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + (absoluteDay - 1));
  return d;
}

/**
 * Real-calendar weekday. 1=Monday … 7=Sunday — matches the previous abstract
 * convention so `dayOfWeek(d) === 1` continues to mean "payroll Monday"
 * without touching every caller.
 */
export function dayOfWeek(absoluteDay: number, year: number = DEFAULT_YEAR): number {
  const d = gameDateToCalendar(absoluteDay, year);
  const real = d.getUTCDay(); // Sun=0 … Sat=6
  return real === 0 ? 7 : real;
}

export function dayName(absoluteDay: number, year: number = DEFAULT_YEAR): string {
  return DAY_NAMES[dayOfWeek(absoluteDay, year) - 1];
}

export function dayNameFull(absoluteDay: number, year: number = DEFAULT_YEAR): string {
  return DAY_NAMES_FULL[dayOfWeek(absoluteDay, year) - 1];
}

/** ISO week-of-year (1..53). For UI use; payroll triggers on dayOfWeek instead. */
export function weekOfYear(absoluteDay: number, year: number = DEFAULT_YEAR): number {
  const d = gameDateToCalendar(absoluteDay, year);
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.valueOf() - firstThursday.valueOf()) / 86400000;
  return 1 + Math.floor((diff + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/**
 * Legacy alias — kept so call sites that import `weekNumber` keep compiling.
 * Returns the ISO week of the year, not the season-relative week.
 */
export function weekNumber(absoluteDay: number, year: number = DEFAULT_YEAR): number {
  return weekOfYear(absoluteDay, year);
}

/** "Sun · Mar 29" — the compact dashboard / nav label. */
export function formatGameDate(absoluteDay: number, year: number = DEFAULT_YEAR): string {
  const d = gameDateToCalendar(absoluteDay, year);
  return `${dayName(absoluteDay, year)} · ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Sunday, March 29, 2026" — the long form for the Season page hero. */
export function formatGameDateLong(absoluteDay: number, year: number = DEFAULT_YEAR): string {
  const d = gameDateToCalendar(absoluteDay, year);
  return `${dayNameFull(absoluteDay, year)}, ${MONTHS_FULL[d.getUTCMonth()]} ${d.getUTCDate()}, ${year}`;
}

/** "Mar 29" — short date only, no weekday. Useful next to "Day N" rows. */
export function formatGameDateShort(absoluteDay: number, year: number = DEFAULT_YEAR): string {
  const d = gameDateToCalendar(absoluteDay, year);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

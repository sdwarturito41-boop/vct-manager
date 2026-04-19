const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function dayOfWeek(absoluteDay: number): number {
  return ((absoluteDay - 1) % 7) + 1; // 1=Mon ... 7=Sun
}

export function dayName(absoluteDay: number): string {
  return DAY_NAMES[dayOfWeek(absoluteDay) - 1];
}

export function dayNameFull(absoluteDay: number): string {
  return DAY_NAMES_FULL[dayOfWeek(absoluteDay) - 1];
}

export function weekNumber(absoluteDay: number): number {
  return Math.ceil(absoluteDay / 7);
}

export function formatGameDate(absoluteDay: number): string {
  const w = weekNumber(absoluteDay);
  const d = dayName(absoluteDay);
  return `${d} · Week ${w}`;
}

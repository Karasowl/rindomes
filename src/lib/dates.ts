import type { RecurringFrequency } from "./types";

// These helpers operate purely on "YYYY-MM" / "YYYY-MM-DD" strings and read only
// local Date *components* (getFullYear/getMonth/getDate). They never round-trip
// through Date.toISOString(), which shifts the calendar day in positive-UTC-offset
// timezones (e.g. a movement captured at local midnight in Asia/Kolkata would land
// on the previous day). Keeping them string-based makes them timezone-safe.

function formatYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function endOfMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number); // monthIndex is 1-based
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export function nextMonthKey(month: string) {
  const [year, monthIndex] = month.split("-").map(Number); // monthIndex is 1-based
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function advanceRecurringDate(date: string, frequency: RecurringFrequency) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day);
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  if (frequency === "biweekly") next.setDate(next.getDate() + 14);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  if (frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
  return formatYmd(next);
}

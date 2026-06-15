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

export function prevMonthKey(month: string) {
  const [year, monthIndex] = month.split("-").map(Number); // monthIndex is 1-based
  const prevYear = monthIndex === 1 ? year - 1 : year;
  const prevMonth = monthIndex === 1 ? 12 : monthIndex - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

// Fecha por defecto al capturar. Si estás en el mes real → hoy. Si estás viendo otro mes →
// el mismo día (acotado al último día del mes) para que el movimiento caiga en el mes que ves,
// no en hoy. Usa componentes locales (timezone-safe, como el resto del módulo).
export function defaultDateForMonth(month: string) {
  const now = new Date();
  const realMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (month === realMonth) return formatYmd(now);
  const [year, monthIndex] = month.split("-").map(Number); // monthIndex is 1-based
  const lastDay = new Date(year, monthIndex, 0).getDate();
  const day = Math.min(now.getDate(), lastDay);
  return `${month}-${String(day).padStart(2, "0")}`;
}

// "2026-06" -> "Junio 2026" / "June 2026". String-based (no Date round-trip) so it stays
// timezone-safe and deterministic, like the rest of this module.
export function formatMonthLabel(month: string, lang: "es" | "en") {
  const [year, monthIndex] = month.split("-").map(Number); // monthIndex is 1-based
  const names = lang === "es"
    ? ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
    : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = names[(monthIndex - 1 + 12) % 12];
  return name ? `${name} ${year}` : month;
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

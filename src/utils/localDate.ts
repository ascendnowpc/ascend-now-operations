// Formats a Date using its local (not UTC) calendar fields, as "YYYY-MM-DD".
// Date.toISOString() converts to UTC first, which silently rolls the date
// forward or back a day for users in non-UTC timezones — never use it for
// "today" when the rest of a form is built from local getFullYear/getMonth/getDate.
export function toLocalDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

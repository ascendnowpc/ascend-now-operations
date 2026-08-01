// Checks a "YYYY-MM-DD" session date against the Set produced by
// fetchLockedMonths, so pages can grey out editing without a round trip.
// The Set is keyed by unpadded "year-month" (e.g. "2026-7"), so the date's
// zero-padded parts have to be normalised through Number() before lookup.
export function isDateInLockedMonth(dateStr: string, lockedMonths: Set<string>): boolean {
  const [year, month] = dateStr.split("-");
  return lockedMonths.has(`${Number(year)}-${Number(month)}`);
}

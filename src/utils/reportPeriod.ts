// A package report's period. The start is meant to be the day the package was
// added, so the report reads as "this package, from when you bought it" rather
// than starting at whenever the first lesson happened to fall. That holds only
// while the package exists before its sessions — for a student backfilled into
// the system (package added 1 Aug 2026, sessions logged from Dec 2025) it put
// the start AFTER the end, and the report claimed a period that excluded every
// session it was billing.
//
// So: the start is the package's added date, but never later than the first
// session in the report, and the end is the last session. A period always
// covers the sessions inside it, and start <= end always holds.

export interface ReportPeriod {
  start: string;
  end: string;
}

/**
 * Derives a package report's period from the packages' added dates and the
 * dates of the sessions it covers. All dates are `YYYY-MM-DD`, which compares
 * correctly as a string.
 *
 * @param createdDates the packages' added dates (a bundle has several)
 * @param sessionDates the session dates the report covers
 * @returns null when there are no sessions — there is no period to report on
 */
export function packageReportPeriod(
  createdDates: readonly string[],
  sessionDates: readonly string[]
): ReportPeriod | null {
  if (sessionDates.length === 0) return null;

  const sorted = [...sessionDates].sort();
  const firstSession = sorted[0];
  const lastSession = sorted[sorted.length - 1];

  const earliestCreated = [...createdDates].sort()[0];
  const start =
    earliestCreated && earliestCreated < firstSession ? earliestCreated : firstSession;

  return { start, end: lastSession };
}

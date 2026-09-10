import type { SessionLog, NoShowType } from "../types/database";
import { isNonBillableNoShow } from "./noShow";

// The aggregation behind the parent dashboard's Activity tab: what happened
// per subject per month, how long the lessons ran, and how many no-shows there
// were. Pure and separate from the components so the counting rules — which
// are business rules, not display details — are stated once and testable.
//
// Two rules run through everything here, and they are the same ones the rest
// of the app already applies (see utils/noShow.ts and utils/packageHours.ts):
//
//   * A no-show is never counted as a session. It was scheduled and it didn't
//     happen, so it gets its own count rather than being folded in — otherwise
//     a parent reads "8 sessions" for a month in which two were missed.
//   * Only No Show + costs the student hours. No Show 1 and No Show 2 deduct
//     nothing, so they add to the no-show count but contribute zero hours.

export interface SubjectActivity {
  subjectId: number | null;
  curriculumId: number | null;
  /** Lessons that actually happened. */
  sessions: number;
  /** Scheduled but missed, of any no-show type. */
  noShows: number;
  /** Hours deducted from the package — completed sessions plus No Show +. */
  hours: number;
}

export interface MonthActivity {
  /** Sortable key, e.g. "2026-03". */
  key: string;
  year: number;
  /** 1-12, not the 0-based month a Date carries. */
  month: number;
  sessions: number;
  noShows: number;
  hours: number;
  /** Per subject within this month, busiest first. */
  subjects: SubjectActivity[];
}

type ActivityLog = Pick<
  SessionLog,
  "session_date" | "session_duration_hrs" | "no_show_type" | "subject_id" | "curriculum_id"
>;

// Hours a single log takes off the package: the full duration for a real
// session or a No Show +, nothing at all for No Show 1/2.
function billableHours(log: Pick<ActivityLog, "no_show_type" | "session_duration_hrs">): number {
  if (isNonBillableNoShow(log.no_show_type)) return 0;
  return log.session_duration_hrs ?? 0;
}

// Reads the year/month out of a session_date without going through Date. The
// column is a plain ISO date string ("2026-03-31") with no time or zone, and
// `new Date("2026-03-31").getMonth()` is evaluated in UTC while getMonth()
// reports local time — which silently shifts a session dated the 1st into the
// previous month for anyone west of UTC. Parsing the string directly keeps a
// lesson in the month it was actually logged in, everywhere.
function yearMonth(sessionDate: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(sessionDate ?? "");
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "?"} ${year}`;
}

/**
 * Session logs grouped by month, and within each month by subject.
 *
 * Months come back newest first (what a parent wants to see on opening the
 * page); subjects within a month are ordered by hours, then by session count,
 * so the subject the child actually spent the month on leads. A log with an
 * unparseable or missing date is dropped rather than bucketed into a made-up
 * month.
 */
export function monthlySubjectActivity(logs: ActivityLog[]): MonthActivity[] {
  const months = new Map<string, MonthActivity>();

  for (const log of logs) {
    const ym = yearMonth(log.session_date);
    if (!ym) continue;

    const key = monthKey(ym.year, ym.month);
    let bucket = months.get(key);
    if (!bucket) {
      bucket = { key, year: ym.year, month: ym.month, sessions: 0, noShows: 0, hours: 0, subjects: [] };
      months.set(key, bucket);
    }

    const isNoShow = log.no_show_type != null;
    const hours = billableHours(log);

    if (isNoShow) bucket.noShows += 1; else bucket.sessions += 1;
    bucket.hours += hours;

    // Subject id and curriculum id together identify the row: the same subject
    // name exists once per curriculum, and SL/HL are separate subject rows, so
    // keying on subject alone would merge things a parent sees as different.
    // A session logged without a subject still counts toward the month and
    // gets its own "no subject" row rather than vanishing from the breakdown.
    const subjectKey = `${log.subject_id ?? ""}:${log.curriculum_id ?? ""}`;
    let subject = bucket.subjects.find((s) => `${s.subjectId ?? ""}:${s.curriculumId ?? ""}` === subjectKey);
    if (!subject) {
      subject = {
        subjectId: log.subject_id ?? null,
        curriculumId: log.curriculum_id ?? null,
        sessions: 0,
        noShows: 0,
        hours: 0,
      };
      bucket.subjects.push(subject);
    }
    if (isNoShow) subject.noShows += 1; else subject.sessions += 1;
    subject.hours += hours;
  }

  const ordered = Array.from(months.values()).sort((a, b) => b.key.localeCompare(a.key));
  for (const m of ordered) {
    m.subjects.sort((a, b) => b.hours - a.hours || b.sessions - a.sessions);
  }
  return ordered;
}

export interface LengthSummary {
  /** Lessons that actually happened and carried a duration. */
  sessions: number;
  /** Their total length in hours. */
  totalHours: number;
  /** Mean length of one lesson, or null when there's nothing to average. */
  averageHours: number | null;
  shortestHours: number | null;
  longestHours: number | null;
}

/**
 * How long the child's lessons actually run.
 *
 * Deliberately counts only real sessions: a no-show has no length to speak of
 * (a No Show + still costs hours, but nobody taught for them), so averaging it
 * in would drag the figure away from "how long is a lesson". Logs with no
 * duration recorded are skipped rather than treated as zero-length, which
 * would do the same thing.
 */
export function sessionLengthSummary(logs: Pick<ActivityLog, "no_show_type" | "session_duration_hrs">[]): LengthSummary {
  const durations = logs
    .filter((l) => l.no_show_type == null && l.session_duration_hrs != null && l.session_duration_hrs > 0)
    .map((l) => l.session_duration_hrs as number);

  if (durations.length === 0) {
    return { sessions: 0, totalHours: 0, averageHours: null, shortestHours: null, longestHours: null };
  }

  const totalHours = durations.reduce((sum, d) => sum + d, 0);
  return {
    sessions: durations.length,
    totalHours,
    averageHours: totalHours / durations.length,
    shortestHours: Math.min(...durations),
    longestHours: Math.max(...durations),
  };
}

export interface NoShowBreakdown {
  total: number;
  byType: { type: NoShowType; count: number; hoursLost: number }[];
  /** Hours No Show + took off the package; No Show 1/2 never cost anything. */
  hoursLost: number;
}

/**
 * No-shows, split by type, with the hours they cost.
 *
 * Types are listed in a fixed order (1, 2, +) rather than by frequency so the
 * breakdown reads the same every month, and a type with no occurrences is left
 * out rather than shown as a zero.
 */
export function noShowBreakdown(logs: Pick<ActivityLog, "no_show_type" | "session_duration_hrs">[]): NoShowBreakdown {
  const order: NoShowType[] = ["no_show_1", "no_show_2", "no_show_plus"];
  const counts = new Map<NoShowType, { count: number; hoursLost: number }>();

  for (const log of logs) {
    const type = log.no_show_type;
    if (type == null) continue;
    const entry = counts.get(type) ?? { count: 0, hoursLost: 0 };
    entry.count += 1;
    entry.hoursLost += billableHours(log);
    counts.set(type, entry);
  }

  const byType = order
    .filter((type) => counts.has(type))
    .map((type) => ({ type, count: counts.get(type)!.count, hoursLost: counts.get(type)!.hoursLost }));

  return {
    total: byType.reduce((sum, t) => sum + t.count, 0),
    byType,
    hoursLost: byType.reduce((sum, t) => sum + t.hoursLost, 0),
  };
}

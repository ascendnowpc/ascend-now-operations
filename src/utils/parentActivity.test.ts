import { describe, it, expect } from "vitest";
import {
  monthlySubjectActivity,
  monthKey,
  monthLabel,
  sessionLengthSummary,
  noShowBreakdown,
} from "./parentActivity";

// Minimal session-log shapes — only the columns the aggregation reads.
type Log = Parameters<typeof monthlySubjectActivity>[0][number];

function log(over: Partial<Log> = {}): Log {
  return {
    session_date: "2026-03-10",
    session_duration_hrs: 1,
    no_show_type: null,
    subject_id: 1,
    curriculum_id: 10,
    ...over,
  };
}

describe("monthlySubjectActivity — lessons per subject per month", () => {
  it("groups sessions into the month their session_date falls in", () => {
    const result = monthlySubjectActivity([
      log({ session_date: "2026-03-02" }),
      log({ session_date: "2026-03-28" }),
      log({ session_date: "2026-04-01" }),
    ]);
    expect(result.map((m) => m.key)).toEqual(["2026-04", "2026-03"]);
    expect(result[1].sessions).toBe(2);
    expect(result[0].sessions).toBe(1);
  });

  it("returns months newest first", () => {
    const result = monthlySubjectActivity([
      log({ session_date: "2025-12-05" }),
      log({ session_date: "2026-06-05" }),
      log({ session_date: "2026-01-05" }),
    ]);
    expect(result.map((m) => m.key)).toEqual(["2026-06", "2026-01", "2025-12"]);
  });

  it("keeps a session dated the 1st in its own month regardless of local timezone", () => {
    // Parsed off the ISO string, never through Date — `new Date("2026-03-01")`
    // is midnight UTC, which reads as 28 February for anyone west of UTC and
    // would silently move the lesson into the previous month.
    const result = monthlySubjectActivity([log({ session_date: "2026-03-01" })]);
    expect(result[0].key).toBe("2026-03");
    expect(result[0].month).toBe(3);
  });

  it("counts a no-show as a no-show, never as a session", () => {
    const result = monthlySubjectActivity([
      log(),
      log({ no_show_type: "no_show_1" }),
      log({ no_show_type: "no_show_plus" }),
    ]);
    expect(result[0].sessions).toBe(1);
    expect(result[0].noShows).toBe(2);
  });

  it("only No Show + costs hours; No Show 1 and 2 deduct nothing", () => {
    const result = monthlySubjectActivity([
      log({ session_duration_hrs: 2 }),
      log({ no_show_type: "no_show_1", session_duration_hrs: 2 }),
      log({ no_show_type: "no_show_2", session_duration_hrs: 2 }),
      log({ no_show_type: "no_show_plus", session_duration_hrs: 2 }),
    ]);
    // 2 (real session) + 0 + 0 + 2 (No Show +)
    expect(result[0].hours).toBe(4);
  });

  it("splits the same subject name across curricula rather than merging them", () => {
    const result = monthlySubjectActivity([
      log({ subject_id: 1, curriculum_id: 10 }),
      log({ subject_id: 1, curriculum_id: 20 }),
    ]);
    expect(result[0].subjects).toHaveLength(2);
  });

  it("keeps a session with no subject in the month, in its own row", () => {
    const result = monthlySubjectActivity([log({ subject_id: null, curriculum_id: null })]);
    expect(result[0].sessions).toBe(1);
    expect(result[0].subjects).toEqual([
      { subjectId: null, curriculumId: null, sessions: 1, noShows: 0, hours: 1 },
    ]);
  });

  it("orders subjects within a month by hours, busiest first", () => {
    const result = monthlySubjectActivity([
      log({ subject_id: 1, session_duration_hrs: 1 }),
      log({ subject_id: 2, session_duration_hrs: 5 }),
      log({ subject_id: 3, session_duration_hrs: 3 }),
    ]);
    expect(result[0].subjects.map((s) => s.subjectId)).toEqual([2, 3, 1]);
  });

  it("drops a log with an unparseable date rather than inventing a month", () => {
    expect(monthlySubjectActivity([log({ session_date: "" })])).toEqual([]);
    expect(monthlySubjectActivity([log({ session_date: "not-a-date" })])).toEqual([]);
  });

  it("treats a null duration as zero hours without dropping the session", () => {
    const result = monthlySubjectActivity([log({ session_duration_hrs: null })]);
    expect(result[0].sessions).toBe(1);
    expect(result[0].hours).toBe(0);
  });

  it("returns nothing for no logs", () => {
    expect(monthlySubjectActivity([])).toEqual([]);
  });
});

describe("monthKey / monthLabel", () => {
  it("zero-pads the month so keys sort chronologically as strings", () => {
    expect(monthKey(2026, 3)).toBe("2026-03");
    expect(monthKey(2026, 12)).toBe("2026-12");
    expect(["2026-12", "2026-03"].sort()).toEqual(["2026-03", "2026-12"]);
  });

  it("names the month from a 1-based number, not a Date's 0-based one", () => {
    expect(monthLabel(2026, 1)).toBe("January 2026");
    expect(monthLabel(2026, 12)).toBe("December 2026");
  });
});

describe("sessionLengthSummary — how long a lesson actually runs", () => {
  it("averages only lessons that actually happened", () => {
    const summary = sessionLengthSummary([
      { no_show_type: null, session_duration_hrs: 1 },
      { no_show_type: null, session_duration_hrs: 2 },
      // A No Show + still costs hours, but nobody taught for it — including it
      // would drag the average away from "how long is a lesson".
      { no_show_type: "no_show_plus", session_duration_hrs: 10 },
    ]);
    expect(summary.sessions).toBe(2);
    expect(summary.totalHours).toBe(3);
    expect(summary.averageHours).toBe(1.5);
  });

  it("reports the shortest and longest lesson", () => {
    const summary = sessionLengthSummary([
      { no_show_type: null, session_duration_hrs: 0.5 },
      { no_show_type: null, session_duration_hrs: 2 },
      { no_show_type: null, session_duration_hrs: 1 },
    ]);
    expect(summary.shortestHours).toBe(0.5);
    expect(summary.longestHours).toBe(2);
  });

  it("skips sessions with no duration recorded rather than counting them as zero-length", () => {
    const summary = sessionLengthSummary([
      { no_show_type: null, session_duration_hrs: 2 },
      { no_show_type: null, session_duration_hrs: null },
      { no_show_type: null, session_duration_hrs: 0 },
    ]);
    expect(summary.sessions).toBe(1);
    expect(summary.averageHours).toBe(2);
  });

  it("has no average at all when there is nothing to average", () => {
    const summary = sessionLengthSummary([]);
    expect(summary).toEqual({
      sessions: 0,
      totalHours: 0,
      averageHours: null,
      shortestHours: null,
      longestHours: null,
    });
  });

  it("has no average when every log is a no-show", () => {
    const summary = sessionLengthSummary([{ no_show_type: "no_show_2", session_duration_hrs: 1 }]);
    expect(summary.averageHours).toBeNull();
  });
});

describe("noShowBreakdown", () => {
  it("counts each type and the hours it cost", () => {
    const result = noShowBreakdown([
      { no_show_type: "no_show_1", session_duration_hrs: 1 },
      { no_show_type: "no_show_1", session_duration_hrs: 1 },
      { no_show_type: "no_show_plus", session_duration_hrs: 2 },
      { no_show_type: null, session_duration_hrs: 3 },
    ]);
    expect(result.total).toBe(3);
    expect(result.byType).toEqual([
      { type: "no_show_1", count: 2, hoursLost: 0 },
      { type: "no_show_plus", count: 1, hoursLost: 2 },
    ]);
    // Only No Show + takes hours off the package.
    expect(result.hoursLost).toBe(2);
  });

  it("lists types in a fixed 1, 2, + order regardless of the log order", () => {
    const result = noShowBreakdown([
      { no_show_type: "no_show_plus", session_duration_hrs: 1 },
      { no_show_type: "no_show_2", session_duration_hrs: 1 },
      { no_show_type: "no_show_1", session_duration_hrs: 1 },
    ]);
    expect(result.byType.map((t) => t.type)).toEqual(["no_show_1", "no_show_2", "no_show_plus"]);
  });

  it("leaves a type out entirely rather than showing it as a zero", () => {
    const result = noShowBreakdown([{ no_show_type: "no_show_2", session_duration_hrs: 1 }]);
    expect(result.byType).toHaveLength(1);
  });

  it("reports nothing when there are no no-shows", () => {
    const result = noShowBreakdown([{ no_show_type: null, session_duration_hrs: 1 }]);
    expect(result).toEqual({ total: 0, byType: [], hoursLost: 0 });
  });
});

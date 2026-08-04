import { describe, it, expect } from "vitest";
import { packageReportPeriod } from "./reportPeriod";

describe("packageReportPeriod", () => {
  it("runs from the day the package was added to the last session", () => {
    expect(packageReportPeriod(["2026-01-05"], ["2026-01-10", "2026-03-02", "2026-02-01"])).toEqual({
      start: "2026-01-05",
      end: "2026-03-02",
    });
  });

  it("starts at the first session when the package was added after it — never after the end", () => {
    // The backfilled-student case: packages added 1 Aug 2026, sessions logged
    // from Dec 2025, which used to produce "1 Aug 2026 – 17 Jul 2026".
    expect(packageReportPeriod(["2026-08-01"], ["2025-12-30", "2026-07-17"])).toEqual({
      start: "2025-12-30",
      end: "2026-07-17",
    });
  });

  it("uses the earliest added date of a multi-pool bundle", () => {
    expect(
      packageReportPeriod(["2026-03-01", "2026-01-15", "2026-02-10"], ["2026-04-01"])
    ).toEqual({ start: "2026-01-15", end: "2026-04-01" });
  });

  it("falls back to the sessions when no added date is known", () => {
    expect(packageReportPeriod([], ["2026-04-01", "2026-02-01"])).toEqual({
      start: "2026-02-01",
      end: "2026-04-01",
    });
  });

  it("returns null when the report covers no sessions", () => {
    expect(packageReportPeriod(["2026-01-05"], [])).toBeNull();
  });

  it("handles a single session — start and end are the same day", () => {
    expect(packageReportPeriod([], ["2026-05-05"])).toEqual({ start: "2026-05-05", end: "2026-05-05" });
  });

  it("keeps the added date when it is the same day as the first session", () => {
    expect(packageReportPeriod(["2026-05-05"], ["2026-05-05", "2026-06-01"])).toEqual({
      start: "2026-05-05",
      end: "2026-06-01",
    });
  });

  it("never returns a period that ends before it starts", () => {
    const cases: [string[], string[]][] = [
      [["2030-01-01"], ["2020-01-01"]],
      [["2020-01-01"], ["2030-01-01"]],
      [[], ["2026-07-17", "2025-12-30"]],
    ];
    for (const [created, sessions] of cases) {
      const period = packageReportPeriod(created, sessions)!;
      expect(period.start <= period.end).toBe(true);
    }
  });

  it("does not mutate the arrays it is given", () => {
    const created = ["2026-03-01", "2026-01-15"];
    const sessions = ["2026-04-01", "2026-02-01"];
    packageReportPeriod(created, sessions);
    expect(created).toEqual(["2026-03-01", "2026-01-15"]);
    expect(sessions).toEqual(["2026-04-01", "2026-02-01"]);
  });
});

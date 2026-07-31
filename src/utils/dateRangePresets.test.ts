import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_DATE_RANGE_PRESET,
  DATE_RANGE_PRESET_OPTIONS,
  toISODate,
  resolvePresetRange,
  pickGranularity,
  bucketKeyForDate,
  bucketLabel,
  generateBucketKeys,
} from "./dateRangePresets";

// Mid-month so month arithmetic can't overflow (subMonths off a 31st can land
// on the following month), and mid-week so the Monday bucketing is visible.
const TODAY = new Date(2026, 6, 15); // Wed 15 Jul 2026, local time

describe("preset options", () => {
  it("defaults to the last 6 months", () => {
    expect(DEFAULT_DATE_RANGE_PRESET).toBe("6m");
    expect(DATE_RANGE_PRESET_OPTIONS.some((o) => o.value === DEFAULT_DATE_RANGE_PRESET)).toBe(true);
  });

  it("offers every preset exactly once, with a label", () => {
    const values = DATE_RANGE_PRESET_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(DATE_RANGE_PRESET_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});

describe("toISODate — local calendar fields, never UTC", () => {
  it("zero-pads month and day", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses the local date even late at night, when UTC would roll over", () => {
    expect(toISODate(new Date(2026, 6, 15, 23, 59))).toBe("2026-07-15");
  });
});

describe("resolvePresetRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends every range at today", () => {
    for (const { value } of DATE_RANGE_PRESET_OPTIONS) {
      if (value === "custom") continue;
      expect(resolvePresetRange(value).to).toBe("2026-07-15");
    }
  });

  it("counts day windows inclusively — '7d' spans 7 days, not 8", () => {
    expect(resolvePresetRange("7d")).toEqual({ from: "2026-07-09", to: "2026-07-15" });
    expect(resolvePresetRange("30d")).toEqual({ from: "2026-06-16", to: "2026-07-15" });
  });

  it("walks back whole months for the month presets", () => {
    expect(resolvePresetRange("3m").from).toBe("2026-04-15");
    expect(resolvePresetRange("6m").from).toBe("2026-01-15");
    expect(resolvePresetRange("12m").from).toBe("2025-07-15");
    expect(resolvePresetRange("24m").from).toBe("2024-07-15");
  });

  it("starts 'ytd' on 1 January of the current year", () => {
    expect(resolvePresetRange("ytd")).toEqual({ from: "2026-01-01", to: "2026-07-15" });
  });

  it("leaves 'all' with no lower bound", () => {
    expect(resolvePresetRange("all").from).toBeNull();
  });

  it("uses the custom bounds when given", () => {
    expect(resolvePresetRange("custom", "2025-03-01", "2025-04-30")).toEqual({
      from: "2025-03-01",
      to: "2025-04-30",
    });
  });

  it("falls back to unbounded-from / today-to when a custom bound is blank", () => {
    expect(resolvePresetRange("custom", "", "")).toEqual({ from: null, to: "2026-07-15" });
    expect(resolvePresetRange("custom", "2025-03-01")).toEqual({
      from: "2025-03-01",
      to: "2026-07-15",
    });
  });
});

describe("pickGranularity — bucket size adapts to the window", () => {
  const to = new Date(2026, 6, 15);
  const daysBefore = (n: number) => new Date(2026, 6, 15 - n);

  it("uses months when there's no lower bound (all time)", () => {
    expect(pickGranularity(null, to)).toBe("month");
  });

  it("uses days up to 35 days", () => {
    expect(pickGranularity(daysBefore(6), to)).toBe("day");
    expect(pickGranularity(daysBefore(35), to)).toBe("day");
  });

  it("switches to weeks past 35 days and up to 120", () => {
    expect(pickGranularity(daysBefore(36), to)).toBe("week");
    expect(pickGranularity(daysBefore(120), to)).toBe("week");
  });

  it("switches to months past 120 days", () => {
    expect(pickGranularity(daysBefore(121), to)).toBe("month");
    expect(pickGranularity(new Date(2024, 6, 15), to)).toBe("month");
  });
});

describe("bucketKeyForDate", () => {
  it("keys a day bucket by its own date", () => {
    expect(bucketKeyForDate(new Date(2026, 6, 15), "day")).toBe("2026-07-15");
  });

  it("keys a week bucket by that week's Monday", () => {
    expect(bucketKeyForDate(new Date(2026, 6, 15), "week")).toBe("2026-07-13"); // Wed -> Mon
    expect(bucketKeyForDate(new Date(2026, 6, 13), "week")).toBe("2026-07-13"); // Mon -> itself
    expect(bucketKeyForDate(new Date(2026, 6, 19), "week")).toBe("2026-07-13"); // Sun -> same week
    expect(bucketKeyForDate(new Date(2026, 6, 20), "week")).toBe("2026-07-20"); // next Mon
  });

  it("keys a month bucket by year-month", () => {
    expect(bucketKeyForDate(new Date(2026, 6, 15), "month")).toBe("2026-07");
    expect(bucketKeyForDate(new Date(2026, 0, 1), "month")).toBe("2026-01");
  });
});

describe("bucketLabel", () => {
  it("labels a month bucket with the short month and 2-digit year", () => {
    expect(bucketLabel("2026-07", "month")).toBe("Jul 26");
    expect(bucketLabel("2026-01", "month")).toBe("Jan 26");
  });

  it("labels day and week buckets with a day and short month", () => {
    expect(bucketLabel("2026-07-15", "day")).toMatch(/^\d{2} Jul$/);
    expect(bucketLabel("2026-07-13", "week")).toMatch(/^\d{2} Jul$/);
  });
});

describe("generateBucketKeys — empty buckets still render as zero", () => {
  it("emits every day in an inclusive range", () => {
    const keys = generateBucketKeys(new Date(2026, 6, 13), new Date(2026, 6, 16), "day");
    expect(keys).toEqual(["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"]);
  });

  it("emits a single bucket when from and to are the same day", () => {
    expect(generateBucketKeys(new Date(2026, 6, 15), new Date(2026, 6, 15), "day")).toEqual([
      "2026-07-15",
    ]);
  });

  it("emits Mondays, including the partial weeks at each end", () => {
    const keys = generateBucketKeys(new Date(2026, 6, 15), new Date(2026, 6, 28), "week");
    expect(keys).toEqual(["2026-07-13", "2026-07-20", "2026-07-27"]);
  });

  it("emits every month, crossing the year boundary", () => {
    const keys = generateBucketKeys(new Date(2025, 10, 20), new Date(2026, 1, 3), "month");
    expect(keys).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("crosses a month boundary in day buckets", () => {
    const keys = generateBucketKeys(new Date(2026, 6, 30), new Date(2026, 7, 2), "day");
    expect(keys).toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  });

  it("never emits an empty list for a valid range", () => {
    expect(generateBucketKeys(new Date(2026, 6, 15), new Date(2026, 6, 15), "week")).toHaveLength(1);
    expect(generateBucketKeys(new Date(2026, 6, 15), new Date(2026, 6, 15), "month")).toHaveLength(1);
  });
});

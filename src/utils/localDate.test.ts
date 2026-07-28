import { describe, it, expect } from "vitest";
import { toLocalDateString } from "./localDate";

describe("toLocalDateString — timezone-safe 'today' formatting", () => {
  it("uses local calendar fields, zero-padded", () => {
    // Construct with local fields so the test is TZ-independent.
    const d = new Date(2026, 0, 5); // 5 Jan 2026, local
    expect(toLocalDateString(d)).toBe("2026-01-05");
  });

  it("pads single-digit months and days", () => {
    expect(toLocalDateString(new Date(2026, 8, 9))).toBe("2026-09-09");
  });

  it("does not roll the date across a day boundary the way toISOString can", () => {
    // Late-evening local time: toISOString() would push this to the next UTC
    // day in negative-offset zones. toLocalDateString must keep the local day.
    const d = new Date(2026, 6, 21, 23, 30); // 21 Jul 2026 23:30 local
    expect(toLocalDateString(d)).toBe("2026-07-21");
  });
});

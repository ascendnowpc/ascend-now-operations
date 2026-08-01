import { describe, it, expect } from "vitest";
import { isDateInLockedMonth } from "./lockedMonths";

describe("isDateInLockedMonth", () => {
  const locked = new Set(["2026-7", "2025-12"]);

  it("locks a date falling inside a locked month", () => {
    expect(isDateInLockedMonth("2026-07-15", locked)).toBe(true);
  });

  it("leaves a date in an unlocked month editable", () => {
    expect(isDateInLockedMonth("2026-08-01", locked)).toBe(false);
  });

  it("matches a zero-padded date against the set's unpadded month key", () => {
    expect(isDateInLockedMonth("2026-07-01", new Set(["2026-7"]))).toBe(true);
  });

  it("locks the first and last day of a locked month alike", () => {
    expect(isDateInLockedMonth("2025-12-01", locked)).toBe(true);
    expect(isDateInLockedMonth("2025-12-31", locked)).toBe(true);
  });

  it("does not leak a lock across the year boundary", () => {
    expect(isDateInLockedMonth("2026-12-15", locked)).toBe(false);
    expect(isDateInLockedMonth("2025-07-15", locked)).toBe(false);
  });

  it("treats every date as editable when nothing is locked", () => {
    expect(isDateInLockedMonth("2026-07-15", new Set())).toBe(false);
  });

  it("does not match a month whose number is a prefix of another", () => {
    // "2026-1" (January) must not swallow October/November/December.
    expect(isDateInLockedMonth("2026-10-05", new Set(["2026-1"]))).toBe(false);
    expect(isDateInLockedMonth("2026-01-05", new Set(["2026-1"]))).toBe(true);
  });

  it("returns false rather than throwing on a malformed date", () => {
    expect(isDateInLockedMonth("", locked)).toBe(false);
    expect(isDateInLockedMonth("not-a-date", locked)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { isNonBillableNoShow, isPayableNoShow, sessionCountLabel } from "./noShow";

describe("noShow predicates — the billing/payout rules", () => {
  it("No Show 1 & 2 are non-billable to the student; No Show + is billable", () => {
    expect(isNonBillableNoShow("no_show_1")).toBe(true);
    expect(isNonBillableNoShow("no_show_2")).toBe(true);
    expect(isNonBillableNoShow("no_show_plus")).toBe(false);
    expect(isNonBillableNoShow(null)).toBe(false); // a real session is not a no-show
  });

  it("No Show 2 & + pay the teacher; No Show 1 pays nothing", () => {
    expect(isPayableNoShow("no_show_1")).toBe(false);
    expect(isPayableNoShow("no_show_2")).toBe(true);
    expect(isPayableNoShow("no_show_plus")).toBe(true);
    expect(isPayableNoShow(null)).toBe(false);
  });

  it("the three no-show types are internally consistent (no type is both non-billable and unpaid-only by accident)", () => {
    // No Show + must deduct AND pay; the only type that is billable to the student.
    expect(isNonBillableNoShow("no_show_plus")).toBe(false);
    expect(isPayableNoShow("no_show_plus")).toBe(true);
  });
});

describe("sessionCountLabel", () => {
  it("pluralises and combines sessions with no-shows", () => {
    expect(sessionCountLabel(1, 0)).toBe("1 session");
    expect(sessionCountLabel(3, 0)).toBe("3 sessions");
    expect(sessionCountLabel(2, 1)).toBe("2 sessions + 1 no-show");
    expect(sessionCountLabel(0, 2)).toBe("2 no-shows");
  });

  it("falls back to '0 sessions' when there is nothing", () => {
    expect(sessionCountLabel(0, 0)).toBe("0 sessions");
  });
});

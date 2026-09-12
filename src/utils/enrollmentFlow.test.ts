import { describe, it, expect } from "vitest";
import {
  INVOICE_PAYMENT_FLOW_ENABLED,
  enrollmentSubmitPlan,
  enrollmentOutcomeHeadline,
  enrollmentOutcomeDetail,
} from "./enrollmentFlow";

const LIVE = enrollmentSubmitPlan(true);
const BYPASSED = enrollmentSubmitPlan(false);

describe("enrollmentSubmitPlan", () => {
  it("emails the invoice and waits for payment when the flow is on", () => {
    expect(LIVE).toEqual({
      sendInvoiceEmail: true,
      autoConfirm: false,
      suppressConfirmationEmails: false,
    });
  });

  it("confirms immediately and sends nothing when the flow is off", () => {
    expect(BYPASSED).toEqual({
      sendInvoiceEmail: false,
      autoConfirm: true,
      suppressConfirmationEmails: true,
    });
  });

  it("never both emails an invoice and confirms the same request itself", () => {
    for (const plan of [LIVE, BYPASSED]) {
      expect(plan.sendInvoiceEmail && plan.autoConfirm).toBe(false);
    }
  });

  it("only ever suppresses confirmation emails on the path that confirms itself", () => {
    for (const plan of [LIVE, BYPASSED]) {
      expect(plan.suppressConfirmationEmails).toBe(plan.autoConfirm);
    }
  });

  it("follows the constant when called with no argument", () => {
    expect(enrollmentSubmitPlan()).toEqual(enrollmentSubmitPlan(INVOICE_PAYMENT_FLOW_ENABLED));
  });
});

describe("enrollmentOutcomeHeadline", () => {
  const outcome = {
    learnerName: "Batu Ozcelik",
    studentId: "BATO26-1",
    recipients: ["parent@example.com", "batu@example.com"],
    hours: 50,
    packageCount: 1,
  };

  it("names who the invoice went to when one was sent", () => {
    expect(enrollmentOutcomeHeadline(outcome, LIVE)).toBe(
      "Invoice sent to parent@example.com and batu@example.com.",
    );
  });

  it("still reads as a sentence when no recipient is known", () => {
    expect(enrollmentOutcomeHeadline({ ...outcome, recipients: [] }, LIVE)).toBe("Invoice sent.");
  });

  it("reports the student and their hours when the request confirmed itself", () => {
    expect(enrollmentOutcomeHeadline(outcome, BYPASSED)).toBe(
      "Batu Ozcelik (BATO26-1) is set up — 50 hrs across package added.",
    );
  });

  it("counts several packages", () => {
    expect(enrollmentOutcomeHeadline({ ...outcome, packageCount: 3, hours: 82 }, BYPASSED)).toBe(
      "Batu Ozcelik (BATO26-1) is set up — 82 hrs across 3 packages added.",
    );
  });

  it("drops the id when the confirm step didn't return one", () => {
    expect(enrollmentOutcomeHeadline({ ...outcome, studentId: null }, BYPASSED)).toBe(
      "Batu Ozcelik is set up — 50 hrs across package added.",
    );
  });
});

describe("enrollmentOutcomeDetail", () => {
  it("names the next step when a family still has to pay", () => {
    expect(enrollmentOutcomeDetail(LIVE)).toMatch(/upload proof of payment/);
  });

  it("says outright that no email went out when the flow is off", () => {
    expect(enrollmentOutcomeDetail(BYPASSED)).toMatch(/no invoice, payment link or email was sent/);
  });
});

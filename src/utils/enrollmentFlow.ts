// Whether the enrollment workflow's money half is switched on.
//
// The full flow is: create the request → email an invoice and a /pay/:token
// link → the family uploads proof of payment → an admin reviews it → the
// student and their packages are created. Every part of that is still here and
// unchanged: the two edge functions, the public payment page, the Enrollments
// queue with its Confirm / Reject / Resend actions.
//
// While this is FALSE the Add / Renew form skips straight to the end. No
// invoice email, no payment link, no proof to upload, no approval step, and no
// enrollment email to anyone — filling in the form creates the student and
// their packages immediately. Turned off 2026-09-12 so students and packages
// can be added directly while the rest of the system is being tested.
//
// Flipping it back to `true` restores the real flow and nothing else needs
// changing — which is the whole point of it being one constant rather than
// deleted code.
export const INVOICE_PAYMENT_FLOW_ENABLED = false;

export interface EnrollmentSubmitPlan {
  /** Email the invoice + payment link, with the invoice PDF attached. */
  sendInvoiceEmail: boolean;
  /** Confirm the request there and then instead of waiting for payment. */
  autoConfirm: boolean;
  /** Tell the confirm step to send no email at all. */
  suppressConfirmationEmails: boolean;
}

/**
 * What submitting the Add / Renew form should actually do.
 *
 * One decision in one place, so the form can't end up emailing an invoice for
 * a request it also confirmed itself. The parameter exists so the rule is
 * testable both ways without touching the constant.
 */
export function enrollmentSubmitPlan(
  invoiceFlowEnabled: boolean = INVOICE_PAYMENT_FLOW_ENABLED,
): EnrollmentSubmitPlan {
  return {
    sendInvoiceEmail: invoiceFlowEnabled,
    autoConfirm: !invoiceFlowEnabled,
    suppressConfirmationEmails: !invoiceFlowEnabled,
  };
}

export interface EnrollmentOutcome {
  /** The learner the request was for. */
  learnerName: string;
  /** Their student id — only known once the request has been confirmed. */
  studentId?: string | null;
  /** Where the invoice went, when one was sent. */
  recipients?: string[];
  hours: number;
  packageCount: number;
}

/**
 * The headline the form shows after a successful submission.
 *
 * The two flows succeed at completely different things — one sent an invoice
 * and is waiting on a family, the other has already created a student and
 * their hours — so saying "Invoice sent" in both would be wrong in one of
 * them.
 */
export function enrollmentOutcomeHeadline(
  outcome: EnrollmentOutcome,
  plan: EnrollmentSubmitPlan = enrollmentSubmitPlan(),
): string {
  if (plan.sendInvoiceEmail) {
    const to = (outcome.recipients ?? []).join(" and ");
    return to ? `Invoice sent to ${to}.` : "Invoice sent.";
  }
  const who = outcome.studentId ? `${outcome.learnerName} (${outcome.studentId})` : outcome.learnerName;
  const what = outcome.packageCount === 1 ? "package" : `${outcome.packageCount} packages`;
  return `${who} is set up — ${outcome.hours} hrs across ${what} added.`;
}

/**
 * The follow-up line, or null when there is nothing further to say.
 *
 * In the real flow this is the next step somebody has to take. With the money
 * half off there is no next step, so the line is the one thing an admin can't
 * see anywhere else: that no email went out.
 */
export function enrollmentOutcomeDetail(
  plan: EnrollmentSubmitPlan = enrollmentSubmitPlan(),
): string {
  return plan.sendInvoiceEmail
    ? "They'll receive the payment link by email. Once they upload proof of payment, review it from the Enrollments queue."
    : "Confirmed immediately — no invoice, payment link or email was sent.";
}

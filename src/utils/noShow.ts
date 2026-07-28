import type { NoShowType } from "../types/database";

// No Show 1 and No Show 2 never touch the student's package — no hours are
// deducted and no invoice line is generated for them. No Show + is the one
// exception: the student still loses the scheduled hour from their package
// (it carries a real course_type_id/subject_id/session_duration_hrs, same
// as a completed session), even though the teacher didn't actually teach it.
export function isNonBillableNoShow(type: NoShowType | string | null): boolean {
  return type === "no_show_1" || type === "no_show_2";
}

// No Show 2 and No Show + both pay the teacher the fixed no-show rate (see
// no_show_settings / useNoShowSettings). No Show 1 pays nothing.
export function isPayableNoShow(type: NoShowType | string | null): boolean {
  return type === "no_show_2" || type === "no_show_plus";
}

// A no-show still deducts hours (No Show +) but never held an actual
// session — every count/hours breakdown in the app (package balances,
// invoices/reports) labels it as its own count rather than folding it into
// "sessions", so it reads as a deduction, not a meeting that happened.
export function sessionCountLabel(sessionCount: number, noShowCount: number): string {
  const parts: string[] = [];
  if (sessionCount > 0) parts.push(`${sessionCount} session${sessionCount !== 1 ? "s" : ""}`);
  if (noShowCount > 0) parts.push(`${noShowCount} no-show${noShowCount !== 1 ? "s" : ""}`);
  return parts.join(" + ") || "0 sessions";
}

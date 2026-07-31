import { supabase } from "./supabaseClient";
import type { AssignmentNotification } from "../utils/assignmentNotifications";

/**
 * Emails the coach/counsellor that a student joined or left their roster.
 *
 * Fire-and-forget, like `notify-flag`/`notify-no-show` in the session-log
 * form: the assignment write has already succeeded by the time this runs, so a
 * failed or slow SMTP round trip must never surface as a failed assignment or
 * make the admin wait. Errors are logged and swallowed deliberately.
 *
 * Uses `supabase.functions.invoke` directly rather than `invokeEdgeFunction`
 * for the same reason the other fire-and-forget calls do — the latter's 401
 * recovery path signs the user out and redirects, which is far too violent a
 * consequence for a notification nobody is waiting on.
 */
export function notifyAssignmentChange(notifications: AssignmentNotification[]): void {
  for (const n of notifications) {
    supabase.functions
      .invoke("notify-assignment-change", {
        body: { role: n.role, event: n.event, assignment_id: n.assignmentId },
      })
      .catch((err) => console.error("[assignment] notification failed:", err));
  }
}

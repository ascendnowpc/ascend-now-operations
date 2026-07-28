// Supabase Edge Function: notify-package-threshold
// Fired (fire-and-forget) after a session log is created. Two distinct
// alerts, both keyed off the session's own package:
//
//  - Over-limit (hours used > hours purchased — includes a package with 0
//    purchased hours, e.g. the zero-hour placeholder
//    handle_session_log_package_lock() creates when no real package exists
//    for a course type): emails the PC EVERY time a session leaves the
//    package negative, not just once. Deliberately not deduped by a stamped
//    column — each additional session logged against an over-limit package
//    is more unaccounted usage the PC needs to act on, not a milestone to
//    only mention once. Covers "package doesn't exist" and "went negative"
//    in one path, since a 0-hour package is just the permanent case of both.
//  - 50%/75%/100% usage milestones (only meaningful for a package with real
//    purchased hours that ISN'T already over limit): emails once per
//    threshold, using student_packages.notified_50_pct_at/75/100 so repeat
//    sessions don't re-notify. A topup resets those flags so they can fire
//    again against the new, larger total (see on_package_topup_inserted()).
//
// Required edge function secrets:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Deploy: supabase functions deploy notify-package-threshold

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THRESHOLDS = [
  { pct: 50, column: "notified_50_pct_at" },
  { pct: 75, column: "notified_75_pct_at" },
  { pct: 100, column: "notified_100_pct_at" },
] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { session_log_id } = await req.json();
    if (!session_log_id) return json({ error: "session_log_id required" }, 400);

    const { data: log, error: logError } = await serviceClient
      .from("session_logs")
      .select("student_package_id")
      .eq("id", session_log_id)
      .single();

    if (logError || !log) return json({ error: "Session log not found" }, 404);
    // Legacy rows predating the student_package_id column — nothing to check.
    if (!log.student_package_id) return json({ skipped: true, reason: "No package linked to this session" });

    const { data: pkg, error: pkgError } = await serviceClient
      .from("student_packages")
      .select("id, student_id, course_type_id, total_hours_purchased, notified_50_pct_at, notified_75_pct_at, notified_100_pct_at")
      .eq("id", log.student_package_id)
      .single();

    if (pkgError || !pkg) return json({ error: "Package not found" }, 404);

    const { data: sessions, error: sessionsError } = await serviceClient
      .from("session_logs")
      .select("session_duration_hrs, no_show_type")
      .eq("student_package_id", pkg.id);
    if (sessionsError) return json({ error: sessionsError.message }, 500);

    const hoursUsed = (sessions ?? [])
      .filter((s) => s.no_show_type === null)
      .reduce((sum, s) => sum + (s.session_duration_hrs ?? 0), 0);
    const totalPurchased = pkg.total_hours_purchased ?? 0;
    const hoursRemainingRaw = totalPurchased - hoursUsed;

    // Over-limit: hours used exceeds hours purchased (includes a 0-hour
    // placeholder package — always over-limit the moment it has any usage
    // at all). Not deduped by the stamped columns below — every session
    // that leaves it negative is worth a fresh alert, not a one-time
    // milestone, since each one is more unaccounted usage piling up.
    const overLimit = hoursRemainingRaw < 0;

    let toFire: typeof THRESHOLDS[number][] = [];
    if (!overLimit) {
      if (totalPurchased <= 0) {
        // 0 purchased hours and 0 (or negative-impossible) used — nothing
        // to alert about yet (e.g. a fresh zero-hour pool with no sessions).
        return json({ skipped: true, reason: "Package has no purchased hours and no usage" });
      }
      const pctUsed = (hoursUsed / totalPurchased) * 100;
      const notifiedAt: Record<string, string | null> = {
        50: pkg.notified_50_pct_at,
        75: pkg.notified_75_pct_at,
        100: pkg.notified_100_pct_at,
      };
      toFire = THRESHOLDS.filter((t) => pctUsed >= t.pct && !notifiedAt[t.pct]);
      if (toFire.length === 0) return json({ skipped: true, reason: "No newly crossed threshold" });
    }

    // Active PC assignment for this student — the same source used for
    // coordinator resolution elsewhere (usePcAssignments.getPcForStudent).
    const { data: assignment } = await serviceClient
      .from("pc_student_assignments")
      .select("pc_teacher_id")
      .eq("student_id", pkg.student_id)
      .is("unassigned_at", null)
      .maybeSingle();

    if (!assignment?.pc_teacher_id) return json({ skipped: true, reason: "Student has no assigned PC" });

    const { data: pc } = await serviceClient
      .from("teachers")
      .select("first_name, last_name, email")
      .eq("id", assignment.pc_teacher_id)
      .single();
    if (!pc?.email) return json({ skipped: true, reason: "PC has no email address on file" });

    const { data: student } = await serviceClient
      .from("students")
      .select("id, first_name, last_name")
      .eq("id", pkg.student_id)
      .single();

    const { data: courseType } = await serviceClient
      .from("course_types")
      .select("name")
      .eq("id", pkg.course_type_id)
      .maybeSingle();

    const studentDisplay = student
      ? `${student.id} - ${student.first_name}${student.last_name ? " " + student.last_name : ""}`
      : pkg.student_id;
    const courseTypeName = courseType?.name ?? "Package";
    const pcName = `${pc.first_name}${pc.last_name ? " " + pc.last_name : ""}`;
    const hoursRemaining = hoursRemainingRaw;
    const highestFired = toFire[toFire.length - 1];

    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: "SMTP_HOST, SMTP_USER, and SMTP_PASS secrets are required" }, 500);
    }

    const client = new SMTPClient({
      connection: { hostname: smtpHost, port: smtpPort, tls: true, auth: { username: smtpUser, password: smtpPass } },
    });

    const badgeColor = overLimit || highestFired?.pct >= 100
      ? { bg: "#fee2e2", fg: "#991b1b" }
      : highestFired?.pct >= 75 ? { bg: "#fef3c7", fg: "#92400e" } : { bg: "#dbeafe", fg: "#1e40af" };
    const headerColor = overLimit || highestFired?.pct >= 100 ? "#7f1d1d" : "#1e3a5f";
    const usageBadgeLabel = overLimit
      ? `${Math.abs(hoursRemaining).toFixed(1)} hrs over`
      : `${highestFired.pct}% used`;
    const subject_ = overLimit
      ? `Action needed: package over limit - ${studentDisplay} (${courseTypeName})`
      : `Package ${highestFired.pct}% Used - ${studentDisplay} (${courseTypeName})`;
    const introText = overLimit
      ? (totalPurchased <= 0
          ? `Hi <strong>${pcName}</strong>, a session for ${studentDisplay} was logged against a ${courseTypeName} package with 0 purchased hours — it's now ${Math.abs(hoursRemaining).toFixed(1)} hrs over. Please add a real package for this student.`
          : `Hi <strong>${pcName}</strong>, a package you coordinate for ${studentDisplay} has gone ${Math.abs(hoursRemaining).toFixed(1)} hrs over its purchased limit. Please top it up or review the sessions logged against it.`)
      : `Hi <strong>${pcName}</strong>, a package you coordinate has reached a usage milestone.`;

    await client.send({
      from: `Ascend Now <${smtpFrom}>`,
      to: pc.email,
      subject: subject_,
      html: `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:${headerColor};padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now - Package Alert</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">${overLimit ? "Package Over Limit" : "Package Usage Update"}</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">${introText}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:140px;border:1px solid #e2e8f0;">Usage</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;"><span style="background:${badgeColor.bg};color:${badgeColor.fg};padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;">${usageBadgeLabel}</span></td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Student</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${studentDisplay}</td>
</tr>
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Package</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${courseTypeName}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Hours Used</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${hoursUsed.toFixed(1)} / ${totalPurchased} hrs</td>
</tr>
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Hours Remaining</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${hoursRemaining.toFixed(1)} hrs</td>
</tr>
</table>
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now session logging system.</p>
</div>
</div>`,
    });

    await client.close();

    // Over-limit alerts are never stamped — every offending session should
    // re-notify. Only the 50/75/100 milestone path is deduped.
    if (!overLimit && toFire.length > 0) {
      const updatePatch: Record<string, string> = {};
      for (const t of toFire) updatePatch[t.column] = new Date().toISOString();
      const { error: updateErr } = await serviceClient
        .from("student_packages")
        .update(updatePatch)
        .eq("id", pkg.id);
      if (updateErr) return json({ error: `Email sent but failed to record notification: ${updateErr.message}` }, 500);
    }

    return json({ success: true, overLimit, thresholdsFired: toFire.map((t) => t.pct) });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

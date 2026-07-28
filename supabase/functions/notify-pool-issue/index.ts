// Supabase Edge Function: notify-pool-issue
// Fired (fire-and-forget) after a session log is created or updated, when
// handle_session_log_package_lock() couldn't cleanly resolve which package
// pool it should deduct from. Two distinct cases:
//
//  - pool_ambiguous: the student has more than one active pool for this
//    course_type (e.g. a Foundation Program / All-In-One student) and no
//    (teacher, subject) resolution has been recorded yet. The session was
//    saved but left unassigned — a PC must pick a pool from the "Pending
//    Deduction" section on the student's "Learner's actual hours" tab.
//  - pool_fallback_used: no active pool existed at all for the logged
//    course_type (e.g. an Academic session for a student with no Academic
//    package), so a fresh zero-hour pool of that SAME course_type was
//    created and the session deducted from it — meaning the student is now
//    over that package's limit (e.g. "1/0 hrs used"). Informational, but a
//    real package should probably be set up (or the enrollment corrected)
//    since this pool never had any purchased hours to begin with.
//
// Required edge function secrets:
//   PUBLIC_APP_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Deploy: supabase functions deploy notify-pool-issue

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      .select("id, student_id, course_type_id, teacher_id, subject_id, program_type_id, session_date, session_duration_hrs, topic, pool_ambiguous, pool_fallback_used")
      .eq("id", session_log_id)
      .single();

    if (logError || !log) return json({ error: "Session log not found" }, 404);
    if (!log.pool_ambiguous && !log.pool_fallback_used) {
      return json({ skipped: true, reason: "Session pool resolved cleanly" });
    }
    if (!log.student_id) return json({ skipped: true, reason: "Session has no student" });

    if (log.pool_ambiguous) {
      // Avoid re-notifying the PC once per session while a prior ambiguous
      // session for the exact same (student, course_type, teacher, subject)
      // is already awaiting their decision.
      let pendingQuery = serviceClient
        .from("session_logs")
        .select("id")
        .eq("student_id", log.student_id)
        .eq("course_type_id", log.course_type_id)
        .eq("teacher_id", log.teacher_id)
        .eq("pool_ambiguous", true)
        .is("student_package_id", null)
        .neq("id", log.id);
      pendingQuery = log.subject_id == null ? pendingQuery.is("subject_id", null) : pendingQuery.eq("subject_id", log.subject_id);
      const { data: otherPending } = await pendingQuery.limit(1).maybeSingle();
      if (otherPending) {
        return json({ skipped: true, reason: "PC already notified about a matching pending session" });
      }
    }

    // Active PC assignment for this student — same source used elsewhere
    // (usePcAssignments.getPcForStudent, notify-package-threshold).
    const { data: assignment } = await serviceClient
      .from("pc_student_assignments")
      .select("pc_teacher_id")
      .eq("student_id", log.student_id)
      .is("unassigned_at", null)
      .maybeSingle();

    if (!assignment?.pc_teacher_id) return json({ skipped: true, reason: "Student has no assigned PC" });

    const { data: pc } = await serviceClient
      .from("teachers")
      .select("first_name, last_name, email")
      .eq("id", assignment.pc_teacher_id)
      .single();
    if (!pc?.email) return json({ skipped: true, reason: "PC has no email address on file" });

    const [{ data: student }, { data: courseType }, { data: teacher }, { data: subject }, { data: programType }] = await Promise.all([
      serviceClient.from("students").select("id, first_name, last_name").eq("id", log.student_id).single(),
      serviceClient.from("course_types").select("name").eq("id", log.course_type_id).maybeSingle(),
      log.teacher_id
        ? serviceClient.from("teachers").select("first_name, last_name").eq("id", log.teacher_id).single()
        : Promise.resolve({ data: null }),
      log.subject_id
        ? serviceClient.from("subjects").select("name").eq("id", log.subject_id).maybeSingle()
        : Promise.resolve({ data: null }),
      // Some billable sessions (e.g. College Counselling / College Essays)
      // carry no subject at all, only a program type — without this, those
      // rendered as a bare "—" instead of naming what the session was.
      log.program_type_id
        ? serviceClient.from("program_types").select("name").eq("id", log.program_type_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const studentDisplay = student
      ? `${student.id} - ${student.first_name}${student.last_name ? " " + student.last_name : ""}`
      : log.student_id;
    const courseTypeName = courseType?.name ?? "Package";
    const pcName = `${pc.first_name}${pc.last_name ? " " + pc.last_name : ""}`;
    const teacherName = teacher ? `${teacher.first_name}${teacher.last_name ? " " + teacher.last_name : ""}` : "—";
    const subjectName = subject?.name ?? log.topic ?? programType?.name ?? "—";

    const publicAppUrl = Deno.env.get("PUBLIC_APP_URL");
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;

    if (!publicAppUrl) return json({ error: "PUBLIC_APP_URL secret is required" }, 500);
    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: "SMTP_HOST, SMTP_USER, and SMTP_PASS secrets are required" }, 500);
    }

    const studentUrl = `${publicAppUrl.replace(/\/$/, "")}/admin/students/${log.student_id}?tab=packages`;

    const client = new SMTPClient({
      connection: { hostname: smtpHost, port: smtpPort, tls: true, auth: { username: smtpUser, password: smtpPass } },
    });

    const isAmbiguous = log.pool_ambiguous;
    const headerColor = "#7f1d1d";
    const subject_ = isAmbiguous
      ? `Action needed: choose which package to deduct from - ${studentDisplay} (${courseTypeName})`
      : `Action needed: ${courseTypeName} package missing - ${studentDisplay}`;
    const intro = isAmbiguous
      ? `Hi <strong>${pcName}</strong>, ${studentDisplay} has more than one active ${courseTypeName} package. A session was logged but hasn't been deducted from any of them yet — please choose which one it should count against.`
      : `Hi <strong>${pcName}</strong>, a session for ${studentDisplay} was logged against ${courseTypeName}, but ${studentDisplay} has no active ${courseTypeName} package. A new package with 0 purchased hours was created so the session had somewhere to deduct from, which means the student is now showing as over that package's limit. Please add a real ${courseTypeName} package for this student, or check whether this session was logged under the wrong program type.`;
    const cta = `<div style="text-align:center;margin:24px 0 8px;"><a href="${studentUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">${isAmbiguous ? "Choose Package" : "View Student"}</a></div>`;

    await client.send({
      from: `Ascend Now <${smtpFrom}>`,
      to: pc.email,
      subject: subject_,
      html: `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:${headerColor};padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now - Package Alert</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">${isAmbiguous ? "Package Assignment Needed" : "Package Missing"}</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">${intro}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:140px;border:1px solid #e2e8f0;">Student</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${studentDisplay}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Package Type</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${courseTypeName}</td>
</tr>
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Teacher</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${teacherName}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Subject / Topic</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${subjectName}</td>
</tr>
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Date</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${log.session_date}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Hours</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${log.session_duration_hrs ?? "—"}</td>
</tr>
</table>
${cta}
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now session logging system.</p>
</div>
</div>`,
    });

    await client.close();

    return json({ success: true, reason: isAmbiguous ? "pool_ambiguous" : "pool_fallback_used" });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

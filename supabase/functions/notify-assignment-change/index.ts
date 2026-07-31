// Supabase Edge Function: notify-assignment-change
// Fired (fire-and-forget) when a student joins or leaves a Performance
// Coach's or College Counsellor's roster — emails that staff member.
//
// The recipient is the coach/counsellor, never the student: assigning is an
// admin-only action, so without this they'd only discover the change by
// noticing it on their My Students page.
//
// Body: { role: "pc" | "cc", event: "assigned" | "ended", assignment_id }
//
// The assignment id — not a caller-supplied student/teacher pair — is what
// gets looked up, so the email always describes a real row and a caller can't
// address mail at an arbitrary person. For a CC assignment being *deleted*,
// call this before the delete, while the row still exists.
//
// Required edge function secrets:
//   PUBLIC_APP_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Deploy: supabase functions deploy notify-assignment-change

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROLE_CONFIG = {
  pc: {
    table: "pc_student_assignments",
    teacherColumn: "pc_teacher_id",
    label: "Performance Coach",
    studentsPath: "/teacher/students",
  },
  cc: {
    table: "cc_student_assignments",
    teacherColumn: "cc_teacher_id",
    label: "College Counsellor",
    studentsPath: "/teacher/cc-students",
  },
} as const;

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

    const { role, event, assignment_id } = await req.json();

    if (role !== "pc" && role !== "cc") return json({ error: "role must be 'pc' or 'cc'" }, 400);
    if (event !== "assigned" && event !== "ended") {
      return json({ error: "event must be 'assigned' or 'ended'" }, 400);
    }
    if (!assignment_id) return json({ error: "assignment_id required" }, 400);

    const config = ROLE_CONFIG[role as "pc" | "cc"];

    const { data: assignment, error: assignmentError } = await serviceClient
      .from(config.table)
      .select(`id, student_id, ${config.teacherColumn}`)
      .eq("id", assignment_id)
      .maybeSingle();

    if (assignmentError) return json({ error: assignmentError.message }, 500);
    if (!assignment) return json({ error: "Assignment not found" }, 404);

    const teacherId = (assignment as Record<string, string>)[config.teacherColumn];

    const [{ data: student }, { data: teacher }] = await Promise.all([
      serviceClient
        .from("students")
        .select("id, first_name, last_name")
        .eq("id", assignment.student_id)
        .maybeSingle(),
      serviceClient
        .from("teachers")
        .select("first_name, last_name, email, is_active")
        .eq("id", teacherId)
        .maybeSingle(),
    ]);

    // A teacher with no email on file, or one who has since been deactivated,
    // is a skip rather than an error — the assignment itself already succeeded
    // and this is a fire-and-forget notification.
    if (!teacher?.email) return json({ skipped: true, reason: "Staff member has no email on file" });
    if (teacher.is_active === false) return json({ skipped: true, reason: "Staff member is deactivated" });

    const studentDisplay = student
      ? `${student.id} - ${student.first_name}${student.last_name ? " " + student.last_name : ""}`
      : assignment.student_id;
    const teacherName = `${teacher.first_name}${teacher.last_name ? " " + teacher.last_name : ""}`;

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

    const studentsUrl = `${publicAppUrl.replace(/\/$/, "")}${config.studentsPath}`;
    const assigned = event === "assigned";

    const heading = assigned ? "New student assigned" : "Student no longer assigned";
    const subject = assigned
      ? `New student assigned — ${studentDisplay}`
      : `Student unassigned — ${studentDisplay}`;
    const intro = assigned
      ? `<strong>${studentDisplay}</strong> has been assigned to you as their <strong>${config.label}</strong>.`
      : `<strong>${studentDisplay}</strong> is no longer assigned to you as their <strong>${config.label}</strong>.`;
    // The reassurance matters most for a CC, whose engagements routinely end
    // while the student carries on — the closed row is exactly what keeps
    // their session logs attributed to this counsellor.
    const note = assigned
      ? "You can log sessions for them and see them on your My Students list."
      : "Your session logs for them are unchanged and stay on your record; they now appear under Completed.";

    const client = new SMTPClient({
      connection: { hostname: smtpHost, port: smtpPort, tls: true, auth: { username: smtpUser, password: smtpPass } },
    });

    const html = `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now - ${config.label}</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">${heading}</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${teacherName}</strong>, ${intro}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:120px;border:1px solid #e2e8f0;">Student</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${studentDisplay}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Your role</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${config.label}</td>
</tr>
</table>
<p style="margin:20px 0 0;font-size:12px;color:#64748b;">${note}</p>
<div style="text-align:center;margin:24px 0 8px;"><a href="${studentsUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">View My Students</a></div>
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`;

    await client.send({ from: `Ascend Now <${smtpFrom}>`, to: teacher.email, subject, html });
    await client.close();

    return json({ success: true, notified: teacher.email });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

// Supabase Edge Function: notify-flag
// Sends an email to the session coordinator (Performance Coach) when a teacher
// flags a session for review.
//
// Required edge function secrets (same as notify-no-show):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Deploy: supabase functions deploy notify-flag

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
      .select("*")
      .eq("id", session_log_id)
      .single();

    if (logError || !log) return json({ error: "Session log not found" }, 404);
    if (!log.flag_for_coach) return json({ error: "Session is not flagged" }, 400);

    const { data: coordinator } = await serviceClient
      .from("teachers")
      .select("first_name, last_name, email")
      .eq("id", log.coordinator_teacher_id)
      .single();

    if (!coordinator?.email) {
      return json({ error: "Coordinator has no email address on file" }, 400);
    }

    const { data: teacher } = await serviceClient
      .from("teachers")
      .select("first_name, last_name, email")
      .eq("id", log.teacher_id)
      .single();

    let studentDisplay = "";
    if (log.student_id) {
      const { data: student } = await serviceClient
        .from("students")
        .select("id, first_name, last_name")
        .eq("id", log.student_id)
        .single();
      if (student) {
        studentDisplay = `${student.id} - ${student.first_name}${student.last_name ? " " + student.last_name : ""}`;
      }
    }
    if (!studentDisplay) {
      const name = `${log.student_first_name ?? ""} ${log.student_last_name ?? ""}`.trim();
      studentDisplay = (log.student_id ? `${log.student_id} - ` : "") + (name || "Unknown");
    }

    const teacherName = teacher
      ? `${teacher.first_name}${teacher.last_name ? " " + teacher.last_name : ""}`
      : "Unknown";
    const coordinatorName = `${coordinator.first_name}${coordinator.last_name ? " " + coordinator.last_name : ""}`;
    const sessionDate = new Date(log.session_date).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
    const flagCategory = log.flag_category ?? "Not specified";
    const flagComments = log.flag_comments ?? "";

    const teacherLine = teacher?.email
      ? `${teacherName} (${teacher.email})`
      : teacherName;

    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: "SMTP_HOST, SMTP_USER, and SMTP_PASS secrets are required" }, 500);
    }

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: true,
        auth: { username: smtpUser, password: smtpPass },
      },
    });

    await client.send({
      from: `Ascend Now <${smtpFrom}>`,
      to: coordinator.email,
      subject: `Action Required - Flag for Review - ${studentDisplay} (${flagCategory})`,
      html: `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:#7f1d1d;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#fca5a5;text-transform:uppercase;letter-spacing:1px;">Ascend Now - Action Required</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Session Flagged for Review</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${coordinatorName}</strong>, a session has been flagged for your attention and requires follow-up.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#fef2f2;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:120px;border:1px solid #e2e8f0;">Category</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;"><span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;">${flagCategory}</span></td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Student</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${studentDisplay}</td>
</tr>
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Teacher</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${teacherLine}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Date</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${sessionDate}</td>
</tr>
${flagComments ? `<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;vertical-align:top;">Comments</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;white-space:pre-wrap;">${flagComments}</td>
</tr>` : ""}
</table>
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now session logging system. Please log in to review and follow up.</p>
</div>
</div>`,
    });

    await client.close();
    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

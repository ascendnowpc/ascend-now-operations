// Supabase Edge Function: notify-homework-submitted
// Fired (fire-and-forget) right after a student submits a homework paper
// (useStudentAttempt.submit()). Emails the paper-owning teacher so they know
// there's a submission waiting to be reviewed and graded/published.
//
// Required edge function secrets (same as the other notify-* functions):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//   PUBLIC_APP_URL — base URL of the dashboard, used to link straight to the review page
//
// Deploy: supabase functions deploy notify-homework-submitted

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

    const { submission_id } = await req.json();
    if (!submission_id) return json({ error: "submission_id required" }, 400);

    const { data: submission, error: subError } = await serviceClient
      .from("submissions")
      .select("id, paper_id, student_id, submitted_at")
      .eq("id", submission_id)
      .single();

    if (subError || !submission) return json({ error: "Submission not found" }, 404);
    if (!submission.submitted_at) return json({ error: "Submission is not submitted yet" }, 400);

    const { data: paper, error: paperError } = await serviceClient
      .from("generated_papers")
      .select("id, created_by_teacher_id, subject_id, curriculum_id, questions_json")
      .eq("id", submission.paper_id)
      .single();

    if (paperError || !paper) return json({ error: "Paper not found" }, 404);

    const { data: teacher } = await serviceClient
      .from("teachers")
      .select("first_name, last_name, email")
      .eq("id", paper.created_by_teacher_id)
      .single();

    if (!teacher?.email) {
      return json({ error: "Teacher has no email address on file" }, 400);
    }

    const { data: student } = await serviceClient
      .from("students")
      .select("id, first_name, last_name")
      .eq("id", submission.student_id)
      .single();

    const [{ data: subject }, { data: curriculum }] = await Promise.all([
      paper.subject_id
        ? serviceClient.from("subjects").select("name").eq("id", paper.subject_id).maybeSingle()
        : Promise.resolve({ data: null }),
      paper.curriculum_id
        ? serviceClient.from("curricula").select("name").eq("id", paper.curriculum_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const teacherName = `${teacher.first_name}${teacher.last_name ? " " + teacher.last_name : ""}`;
    const studentDisplay = student
      ? `${student.id} - ${student.first_name}${student.last_name ? " " + student.last_name : ""}`
      : submission.student_id;
    const subjectLabel = [subject?.name, curriculum?.name].filter(Boolean).join(" — ");
    const totalQuestions = paper.questions_json?.total_questions ?? paper.questions_json?.questions?.length ?? null;
    const submittedDate = new Date(submission.submitted_at).toLocaleString("en-GB", {
      day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    const publicAppUrl = Deno.env.get("PUBLIC_APP_URL");
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: "SMTP_HOST, SMTP_USER, and SMTP_PASS secrets are required" }, 500);
    }

    const reviewUrl = publicAppUrl
      ? `${publicAppUrl.replace(/\/$/, "")}/teacher/homework/${paper.id}`
      : null;

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: true,
        auth: { username: smtpUser, password: smtpPass },
      },
    });

    try {
      await client.send({
        from: `Ascend Now <${smtpFrom}>`,
        to: teacher.email,
        subject: `Homework Submitted - ${studentDisplay}${subjectLabel ? ` (${subjectLabel})` : ""}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now — Homework</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Homework Submitted</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${teacherName}</strong>, a student has submitted their homework and it's ready for your review.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:120px;border:1px solid #e2e8f0;">Student</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${studentDisplay}</td>
</tr>
${subjectLabel ? `<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Subject</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${subjectLabel}</td>
</tr>` : ""}
${totalQuestions != null ? `<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Questions</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${totalQuestions}</td>
</tr>` : ""}
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Submitted</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${submittedDate}</td>
</tr>
</table>
<p style="margin:20px 0 0;font-size:14px;color:#475569;">Auto/AI grading has already run, but the student won't see any marks until you review and publish the grade.</p>
${reviewUrl ? `<div style="text-align:center;margin:20px 0 8px;">
<a href="${reviewUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">Review &amp; Publish Grade</a>
</div>
<p style="margin:8px 0 0;font-size:12px;color:#94a3b8;text-align:center;">Or copy this link: ${reviewUrl}</p>` : ""}
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`,
      });
    } finally {
      await client.close();
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

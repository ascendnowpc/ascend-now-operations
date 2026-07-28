// Supabase Edge Function: notify-homework-published
// Fired (fire-and-forget) right after a teacher publishes a homework paper
// (useGeneratedPaper.publish(), draft -> published). Emails the student to
// let them know a new paper is waiting on their "My Homework" tab.
//
// Recipient: students.notification_email (the "send updates to" address),
// falling back to students.email when notification_email is blank — same
// fallback used everywhere else in this codebase (see VERIFIED_DATABASE_STATE.md).
//
// Required edge function secrets (same as the other notify-* functions):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//   PUBLIC_APP_URL — base URL of the dashboard, used to link straight to the paper
//
// Deploy: supabase functions deploy notify-homework-published

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

    const { paper_id } = await req.json();
    if (!paper_id) return json({ error: "paper_id required" }, 400);

    const { data: paper, error: paperError } = await serviceClient
      .from("generated_papers")
      .select("id, student_id, subject_id, curriculum_id, status, questions_json")
      .eq("id", paper_id)
      .single();

    if (paperError || !paper) return json({ error: "Paper not found" }, 404);
    if (paper.status !== "published") return json({ error: "Paper is not published" }, 400);

    const { data: student } = await serviceClient
      .from("students")
      .select("id, first_name, last_name, email, notification_email")
      .eq("id", paper.student_id)
      .single();

    const recipient = student?.notification_email?.trim() || student?.email?.trim();
    if (!recipient) {
      return json({ error: "Student has no notification email or email on file" }, 400);
    }

    const [{ data: subject }, { data: curriculum }] = await Promise.all([
      paper.subject_id
        ? serviceClient.from("subjects").select("name").eq("id", paper.subject_id).maybeSingle()
        : Promise.resolve({ data: null }),
      paper.curriculum_id
        ? serviceClient.from("curricula").select("name").eq("id", paper.curriculum_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const studentName = student ? `${student.first_name}${student.last_name ? " " + student.last_name : ""}` : "there";
    const totalQuestions = paper.questions_json?.total_questions ?? paper.questions_json?.questions?.length ?? null;
    const subjectLabel = [subject?.name, curriculum?.name].filter(Boolean).join(" — ");

    const publicAppUrl = Deno.env.get("PUBLIC_APP_URL");
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: "SMTP_HOST, SMTP_USER, and SMTP_PASS secrets are required" }, 500);
    }

    const homeworkUrl = publicAppUrl
      ? `${publicAppUrl.replace(/\/$/, "")}/student/homework/${paper.id}`
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
        to: recipient,
        subject: `New Homework Assigned${subjectLabel ? ` — ${subjectLabel}` : ""}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now — Homework</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">New Homework Assigned</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${studentName}</strong>, your teacher has published a new homework paper for you.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
${subjectLabel ? `<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:120px;border:1px solid #e2e8f0;">Subject</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${subjectLabel}</td>
</tr>` : ""}
${totalQuestions != null ? `<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Questions</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${totalQuestions}</td>
</tr>` : ""}
</table>
${homeworkUrl ? `<div style="text-align:center;margin:28px 0 8px;">
<a href="${homeworkUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">View Homework</a>
</div>
<p style="margin:8px 0 0;font-size:12px;color:#94a3b8;text-align:center;">Or copy this link: ${homeworkUrl}</p>` : `<p style="margin:20px 0 0;font-size:14px;color:#475569;">Log in to your Ascend Now dashboard and open the "My Homework" tab to view it.</p>`}
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

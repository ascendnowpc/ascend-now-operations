// Supabase Edge Function: notify-renewal-request
// Fired (fire-and-forget) right after a Performance Coach submits a
// package_renewal_requests row — emails every active admin that a student
// needs their package renewed, with a direct link to the Renewal Requests
// queue so they can acknowledge it.
//
// Required edge function secrets:
//   PUBLIC_APP_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Deploy: supabase functions deploy notify-renewal-request

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

    const { renewal_request_id } = await req.json();
    if (!renewal_request_id) return json({ error: "renewal_request_id required" }, 400);

    const { data: reqRow, error: reqError } = await serviceClient
      .from("package_renewal_requests")
      .select("id, student_id, course_type_id, requested_hours, package_size_label, note, requested_by_teacher_id, status, created_at")
      .eq("id", renewal_request_id)
      .single();

    if (reqError || !reqRow) return json({ error: "Renewal request not found" }, 404);
    if (reqRow.status !== "pending") {
      return json({ skipped: true, reason: `Request is already '${reqRow.status}'` });
    }

    const [{ data: student }, { data: courseType }, { data: pc }, { data: admins }] = await Promise.all([
      serviceClient.from("students").select("id, first_name, last_name").eq("id", reqRow.student_id).single(),
      serviceClient.from("course_types").select("name").eq("id", reqRow.course_type_id).maybeSingle(),
      serviceClient.from("teachers").select("first_name, last_name, email").eq("id", reqRow.requested_by_teacher_id).maybeSingle(),
      serviceClient.from("users").select("email, full_name").eq("role", "admin").eq("is_active", true),
    ]);

    const adminEmails = (admins ?? []).map((a) => a.email).filter((e): e is string => !!e);
    if (adminEmails.length === 0) return json({ skipped: true, reason: "No active admin has an email on file" });

    const studentDisplay = student
      ? `${student.id} - ${student.first_name}${student.last_name ? " " + student.last_name : ""}`
      : reqRow.student_id;
    const courseTypeName = courseType?.name ?? "Package";
    const pcName = pc ? `${pc.first_name}${pc.last_name ? " " + pc.last_name : ""}` : "A Performance Coach";

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

    const queueUrl = `${publicAppUrl.replace(/\/$/, "")}/admin/renewal-requests`;

    const client = new SMTPClient({
      connection: { hostname: smtpHost, port: smtpPort, tls: true, auth: { username: smtpUser, password: smtpPass } },
    });

    const html = `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now - Renewal Request</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Package Renewal Requested</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;"><strong>${pcName}</strong> has requested that ${studentDisplay}'s <strong>${courseTypeName}</strong> package be renewed.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:150px;border:1px solid #e2e8f0;">Student</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${studentDisplay}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Package Type</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${courseTypeName}</td>
</tr>
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Requested by</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${pcName}</td>
</tr>
${reqRow.requested_hours != null ? `<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Suggested hours</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${reqRow.requested_hours}${reqRow.package_size_label ? ` (${reqRow.package_size_label})` : ""}</td>
</tr>` : ""}
${reqRow.note ? `<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Note</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${reqRow.note}</td>
</tr>` : ""}
</table>
<div style="text-align:center;margin:24px 0 8px;"><a href="${queueUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">View Renewal Requests</a></div>
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`;

    for (const to of adminEmails) {
      await client.send({ from: `Ascend Now <${smtpFrom}>`, to, subject: `Renewal requested — ${studentDisplay} (${courseTypeName})`, html });
    }

    await client.close();

    return json({ success: true, notified: adminEmails.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

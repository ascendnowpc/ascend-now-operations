// Supabase Edge Function: send-enrollment-invoice
// Emails the student/parent an invoice summary (student + package details —
// no pricing yet, that's a future addition) plus a link to a public page
// where they can upload proof of payment. Called by the admin dashboard
// right after an enrollment_requests row is created (new student or
// renewal), and can be called again to resend the same email.
//
// Only callable by authenticated admins.
//
// Required edge function secrets:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//   PUBLIC_APP_URL — base URL of the dashboard (e.g. https://app.ascendnow.com),
//                    used to build the /pay/:token link
//
// Deploy: supabase functions deploy send-enrollment-invoice

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Runs a non-critical task (here, the invoice email) after the response has
// already been prepared, instead of making the caller wait on an SMTP round
// trip. EdgeRuntime.waitUntil (Deno Deploy / Supabase Edge Functions) keeps
// the isolate alive until the task settles even though the response was
// already sent — without it, work kicked off but not awaited can get cut
// off the moment the response goes out.
const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
function runInBackground(task: Promise<unknown>) {
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
}

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await callerClient.from("users").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return json({ error: "Forbidden — admin only" }, 403);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { enrollment_request_id, coordinator_name, invoice_pdf_base64 } = await req.json();
    if (!enrollment_request_id) return json({ error: "enrollment_request_id is required" }, 400);

    const { data: enrollment, error: enrollErr } = await serviceClient
      .from("enrollment_requests")
      .select("*")
      .eq("id", enrollment_request_id)
      .single();

    if (enrollErr || !enrollment) {
      return json({ error: enrollErr ? `Enrollment lookup failed: ${enrollErr.message}` : "Enrollment request not found" }, 404);
    }
    if (enrollment.status === "confirmed") return json({ error: "This enrollment has already been confirmed" }, 400);

    // A request can carry more than one package (added 2026-07-25) — one
    // invoice email still covers all of them. Course type names are
    // resolved separately rather than via a `course_types(name)` embed —
    // this codebase has hit PostgREST embedding issues before (see
    // useInvoices.ts) and resolves relation names client-side instead.
    const { data: packages, error: packagesErr } = await serviceClient
      .from("enrollment_request_packages")
      .select("course_type_id, hours, package_size_label")
      .eq("enrollment_request_id", enrollment.id)
      .order("sort_order", { ascending: true });
    if (packagesErr || !packages || packages.length === 0) {
      return json({ error: packagesErr ? `Package lookup failed: ${packagesErr.message}` : "This enrollment request has no packages" }, 400);
    }

    const { data: courseTypeRows } = await serviceClient
      .from("course_types")
      .select("id, name")
      .in("id", Array.from(new Set(packages.map((p) => p.course_type_id))));
    const courseTypeNameById = new Map((courseTypeRows ?? []).map((c) => [c.id as number, c.name as string]));
    const packageLines = packages.map((p) => ({
      courseTypeName: courseTypeNameById.get(p.course_type_id) ?? "Package",
      packageSizeLabel: p.package_size_label as string,
      hours: Number(p.hours),
    }));
    const totalHours = packageLines.reduce((sum, p) => sum + p.hours, 0);

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

    const paymentUrl = `${publicAppUrl.replace(/\/$/, "")}/pay/${enrollment.payment_link_token}`;
    const fullName = `${enrollment.first_name} ${enrollment.last_name}`.trim();
    const kindLabel = enrollment.enrollment_type === "new_student" ? "New Enrollment" : "Package Renewal";

    // One row per package, alternating shading like the rest of this table;
    // a bold Total row is only useful once there's more than one to sum.
    const packageRowsHtml = packageLines
      .map((p, i) => `<tr${i % 2 === 0 ? ' style="background:#f8fafc;"' : ""}>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">${packageLines.length > 1 ? `Package ${i + 1}` : "Package"}</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${p.courseTypeName} — ${p.packageSizeLabel} (${p.hours} hrs)</td>
</tr>`)
      .join("");
    const totalRowHtml = packageLines.length > 1
      ? `<tr style="background:#eff6ff;">
<td style="padding:10px 14px;color:#1e3a5f;font-weight:700;border:1px solid #e2e8f0;">Total</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:700;color:#1e3a5f;">${totalHours} hrs across ${packageLines.length} packages</td>
</tr>`
      : "";

    // The invoice + payment link goes to both the parent (enrollment.email)
    // and the student (enrollment.student_email) so either can complete
    // payment — deduped in case both are the same address or the student
    // email wasn't captured (older/legacy requests).
    const recipients = Array.from(
      new Set([enrollment.email, enrollment.student_email].filter((e): e is string => !!e && e.trim().length > 0).map((e) => e.trim().toLowerCase()))
    );

    // Sending is deferred to the background (below, via runInBackground) so
    // the admin isn't stuck waiting on an SMTP connection per recipient —
    // one client is still reused for every recipient in this request.
    const sendInvoiceEmails = async () => {
      const client = new SMTPClient({
        connection: {
          hostname: smtpHost,
          port: smtpPort,
          tls: true,
          auth: { username: smtpUser, password: smtpPass },
        },
      });
      try {
        for (const to of recipients) {
          await client.send({
            from: `Ascend Now <${smtpFrom}>`,
            to,
            subject: `Ascend Now - Invoice & Payment Link (${kindLabel})`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now — ${kindLabel}</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Invoice Summary</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${fullName}</strong>, please find the details of your ${enrollment.enrollment_type === "new_student" ? "enrollment" : "package renewal"} below. Once payment is made, please upload a screenshot of your payment confirmation using the link below.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:160px;border:1px solid #e2e8f0;">Student</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${fullName}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Parent/Guardian</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${enrollment.parent_full_name ?? "—"}</td>
</tr>
${packageRowsHtml}
${totalRowHtml}
${coordinator_name ? `<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Coordinator</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${coordinator_name}</td>
</tr>` : ""}
${enrollment.note ? `<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;vertical-align:top;">Note</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;white-space:pre-wrap;">${enrollment.note}</td>
</tr>` : ""}
</table>
<div style="text-align:center;margin:28px 0 8px;">
<a href="${paymentUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">Make Payment &amp; Upload Proof</a>
</div>
<p style="margin:8px 0 0;font-size:12px;color:#94a3b8;text-align:center;">Or copy this link: ${paymentUrl}</p>
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">${invoice_pdf_base64 ? "A copy of this invoice is attached as a PDF. " : ""}Sent by Ascend Now.</p>
</div>
</div>`,
            attachments: invoice_pdf_base64
              ? [{
                  filename: `Invoice_${fullName.replace(/\s+/g, "_")}.pdf`,
                  content: invoice_pdf_base64,
                  encoding: "base64",
                }]
              : undefined,
          });
        }
      } finally {
        await client.close();
      }
    };

    runInBackground(sendInvoiceEmails().catch((emailErr) => console.error("Failed to send invoice email:", emailErr)));

    return json({ success: true, paymentUrl });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

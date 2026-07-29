// Supabase Edge Function: send-teacher-credentials
// Re-sends the "your login details" welcome email to a teacher / performance
// coach who ALREADY exists.
//
// Why this exists: create-teacher-with-user emails credentials only as a side
// effect of creating the account, so there was no way to (re)send that email to
// someone already in the system — e.g. staff seeded by a migration through a
// direct auth.users insert, which deliberately sends no email. Calling
// create-teacher-with-user for them would just fail on the duplicate email.
//
// The email body is byte-for-byte the one create-teacher-with-user sends, so the
// recipient gets the identical message.
//
// The password cannot be recovered from auth.users (it is bcrypt-hashed), so the
// caller supplies it and is responsible for it being the account's real one.
// Verify before calling, e.g.:
//   select encrypted_password = crypt('<password>', encrypted_password)
//   from auth.users where email = '<email>';
//
// Only callable by authenticated admins, matching create-teacher-with-user.
//
// Deploy: supabase functions deploy send-teacher-credentials

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    // Verify the caller is a logged-in admin using their JWT.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await callerClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") return json({ error: "Forbidden — admin only" }, 403);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return json({ error: "email and password are required" }, 400);
    }

    // Look the teacher up so the email's name / role wording comes from the
    // database rather than the caller.
    const { data: teacher, error: teacherError } = await serviceClient
      .from("teachers")
      .select("first_name, last_name, email, is_performance_coach, user_id")
      .eq("email", email)
      .single();

    if (teacherError || !teacher) return json({ error: `No teacher found with email ${email}` }, 404);

    const { data: userRow, error: userRowError } = await serviceClient
      .from("users")
      .select("username")
      .eq("id", teacher.user_id)
      .single();

    if (userRowError || !userRow) return json({ error: "Teacher has no linked users row" }, 404);

    // Awaited, not backgrounded: the caller needs to know whether SMTP actually
    // accepted the message. create-teacher-with-user backgrounds it because the
    // admin there is waiting on an account-creation response; here the send IS
    // the operation.
    await sendWelcomeEmail({
      first_name: teacher.first_name,
      last_name: teacher.last_name,
      email: teacher.email,
      username: userRow.username,
      password,
      is_performance_coach: teacher.is_performance_coach,
    });

    return json({ data: { sent_to: teacher.email, username: userRow.username } });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

async function sendWelcomeEmail(opts: {
  first_name: string;
  last_name?: string | null;
  email: string;
  username: string;
  password: string;
  is_performance_coach: boolean;
}) {
  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;
  // Optional — email still sends without it, just without a direct login link.
  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL");

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS secrets are required");
  }

  const client = new SMTPClient({
    connection: {
      hostname: smtpHost,
      port: smtpPort,
      tls: true,
      auth: { username: smtpUser, password: smtpPass },
    },
  });

  const fullName = `${opts.first_name}${opts.last_name ? " " + opts.last_name : ""}`;
  const roleLabel = opts.is_performance_coach ? "PC" : "teacher";
  const loginUrl = publicAppUrl ? `${publicAppUrl.replace(/\/$/, "")}/login` : null;

  await client.send({
    from: `Ascend Now <${smtpFrom}>`,
    to: opts.email,
    subject: "Welcome to Ascend Now - your login details",
    html: `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Welcome aboard!</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${fullName}</strong>, your Ascend Now ${roleLabel} account has been created. Here are your login details:</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr style="background:#f8fafc;">
<td style="padding:10px 14px;color:#64748b;font-weight:600;width:120px;border:1px solid #e2e8f0;">Username</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${opts.username}</td>
</tr>
<tr>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">Password</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${opts.password}</td>
</tr>
</table>
<p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">For security, please log in and change your password as soon as possible.</p>
${loginUrl ? `<div style="text-align:center;margin:20px 0 8px;"><a href="${loginUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">Log In to Ascend Now</a></div>` : ""}
<p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`,
  });

  await client.close();
}

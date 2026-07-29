// Supabase Edge Function: create-teacher-with-user
// Creates a Supabase Auth account + public.users row (via trigger) +
// teachers row + teacher_subjects rows in one atomic-ish operation.
// Only callable by authenticated admins.
//
// Deploy: supabase functions deploy create-teacher-with-user

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Runs a non-critical task (here, the welcome email) after the response has
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

    // Service-role client for privileged operations.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json();
    const {
      username,
      email,
      password,
      first_name,
      last_name,
      country,
      phone_number,
      is_performance_coach = false,
      subjects = [],
    } = body;

    if (!username || !email || !password || !first_name || !last_name) {
      return json({ error: "username, email, password, first_name, and last_name are required" }, 400);
    }

    // 1. Create Supabase Auth user. The trg_create_user_profile trigger
    //    fires automatically and creates the public.users row.
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        username,
        full_name: `${first_name}${last_name ? " " + last_name : ""}`,
        role: is_performance_coach ? "performance_coach" : "teacher",
      },
      email_confirm: true,
    });

    if (authError) return json({ error: authError.message }, 400);

    const userId = authData.user.id;

    // 2. Create teacher row linked to the new user.
    const { data: teacher, error: teacherError } = await serviceClient
      .from("teachers")
      .insert({
        user_id: userId,
        first_name,
        last_name,
        country: country || null,
        email,
        phone_number: phone_number || null,
        is_performance_coach,
      })
      .select()
      .single();

    if (teacherError) {
      // Rollback: remove the auth user we just created.
      await serviceClient.auth.admin.deleteUser(userId);
      return json({ error: teacherError.message }, 400);
    }

    // 3. Insert subjects (non-fatal if this fails).
    if (subjects.length > 0 && teacher) {
      await serviceClient
        .from("teacher_subjects")
        .insert(
          (subjects as Array<{ subject_id: number; curriculum_id: number | null }>).map((s) => ({
            teacher_id: teacher.id,
            subject_id: s.subject_id,
            curriculum_id: s.curriculum_id ?? null,
          }))
        );
    }

    // 4. Email the new teacher their login credentials — sent in the
    // background (not on the request/response critical path) so the admin
    // isn't stuck waiting on an SMTP connection; still non-fatal if it fails.
    runInBackground(
      sendWelcomeEmail({ first_name, last_name, email, username, password, is_performance_coach })
        .catch((emailErr) => console.error("Failed to send welcome email:", emailErr))
    );

    return json({ data: teacher });
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

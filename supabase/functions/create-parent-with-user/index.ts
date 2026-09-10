// Supabase Edge Function: create-parent-with-user
// Creates a Supabase Auth account + public.users row (via trigger) + parents
// row in one atomic-ish operation, then emails the parent their login details.
// Only callable by authenticated admins.
//
// This is the ONLY way a parent account comes into existence — mirroring how
// create-teacher-with-user owns teacher accounts and review-enrollment-payment
// owns student ones. A parent is created up front, on its own admin route, and
// is then picked (by id) on the enroll form for the first child and reused for
// every sibling after that.
//
// Only first name, last name and email are required. The username and password
// are derived the same way every other account in this system derives them
// (email local part / "<firstname>@ascendnow") unless the caller overrides
// them, so an admin never has to invent credentials.
//
// Deploy: supabase functions deploy create-parent-with-user

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Runs a non-critical task (here, the credentials email) after the response has
// already been prepared, instead of making the caller wait on an SMTP round
// trip. Same helper create-teacher-with-user uses, and for the same reason:
// without EdgeRuntime.waitUntil, work kicked off but not awaited can get cut
// off the moment the response goes out.
const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
function runInBackground(task: Promise<unknown>) {
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
}

function usernameFromEmail(email: string) {
  return (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function passwordFromFirstName(firstName: string) {
  return `${(firstName || "user").trim().toLowerCase()}@ascendnow`;
}

// users.username is UNIQUE — the email-local-part base is usually unique on its
// own, but two families can share one (a shared "info@" address, or the same
// local part on different domains). Falls back to appending a counter only if
// the plain base is already taken. Copied from review-enrollment-payment, which
// solves the identical problem for student logins.
async function uniqueUsername(serviceClient: ReturnType<typeof createClient>, base: string) {
  const root = base || "parent";
  let candidate = root;
  let n = 2;
  while (true) {
    const { data } = await serviceClient.from("users").select("id").eq("username", candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${root}${n}`;
    n += 1;
  }
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
      first_name,
      last_name,
      email,
      phone_number = null,
      username: usernameOverride = null,
      password: passwordOverride = null,
    } = body;

    const firstName = String(first_name ?? "").trim();
    const lastName = String(last_name ?? "").trim();
    const parentEmail = String(email ?? "").trim();

    if (!firstName || !lastName || !parentEmail) {
      return json({ error: "first_name, last_name and email are required" }, 400);
    }

    // A parent's email is how the family is recognised when a sibling enrols,
    // so a second account on the same address would defeat the whole point of
    // reusing one household record. Checked case-insensitively, matching the
    // parents_email_lower_idx index the enroll form's lookup uses.
    const { data: existingParent } = await serviceClient
      .from("parents")
      .select("id, first_name, last_name")
      .ilike("email", parentEmail)
      .maybeSingle();

    if (existingParent) {
      return json({
        error: `${existingParent.first_name} ${existingParent.last_name} (${existingParent.id}) already uses ${parentEmail}. Pick that parent instead of creating a second account for the same family.`,
      }, 409);
    }

    const username = usernameOverride
      ? String(usernameOverride).trim()
      : await uniqueUsername(serviceClient, usernameFromEmail(parentEmail));
    const password = passwordOverride ? String(passwordOverride) : passwordFromFirstName(firstName);

    // 1. Create the Auth account. The trg_create_user_profile trigger fires
    //    automatically and creates the matching public.users row, reading the
    //    role straight out of user_metadata — 'parent' is a real user_role
    //    value again as of 20260910000000.
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email: parentEmail,
      password,
      user_metadata: {
        username,
        full_name: `${firstName} ${lastName}`,
        role: "parent",
      },
      email_confirm: true,
    });

    if (authError || !authData.user) return json({ error: authError?.message ?? "Failed to create login" }, 400);

    const userId = authData.user.id;

    // 2. Create the parents row linked to that login. Its mnemonic id
    //    (SARK26-1) is generated by the trg_generate_parent_id trigger.
    const { data: parent, error: parentError } = await serviceClient
      .from("parents")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email: parentEmail,
        phone_number: phone_number || null,
        user_id: userId,
      })
      .select()
      .single();

    if (parentError || !parent) {
      // Rollback: an orphaned auth account would block this email forever.
      await serviceClient.auth.admin.deleteUser(userId);
      return json({ error: parentError?.message ?? "Failed to create parent" }, 400);
    }

    // 3. Email the credentials — backgrounded so the admin isn't stuck waiting
    //    on an SMTP connection, and non-fatal: the account exists either way,
    //    and the admin can see the username/password in the response.
    runInBackground(
      sendWelcomeEmail({ first_name: firstName, last_name: lastName, email: parentEmail, username, password })
        .catch((emailErr) => console.error("Failed to send parent welcome email:", emailErr))
    );

    return json({ data: { parent, credentials: { username, password } } });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

async function sendWelcomeEmail(opts: {
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  password: string;
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

  const fullName = `${opts.first_name} ${opts.last_name}`;
  const loginUrl = publicAppUrl ? `${publicAppUrl.replace(/\/$/, "")}/login` : null;

  await client.send({
    from: `Ascend Now <${smtpFrom}>`,
    to: opts.email,
    subject: "Welcome to Ascend Now - your parent login details",
    html: `<div style="font-family:Arial,sans-serif;max-width:540px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Welcome to Ascend Now!</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${fullName}</strong>, your Ascend Now parent account has been created. You can follow every child enrolled under your account — their sessions, hours, homework and reports. Here are your login details:</p>
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

// Supabase Edge Function: create-student-with-user
// Creates a Supabase Auth account + public.users row (via trigger) + students
// row + the PC assignment in one atomic-ish operation, then emails the student
// their login details. Only callable by authenticated admins.
//
// Why this exists alongside review-enrollment-payment: until now the ONLY way a
// student could come into existence was the enrollment workflow — raise an
// invoice, email a payment link, wait for a payment screenshot, review it,
// confirm. That is the right flow when money is actually changing hands, and it
// stays. It is the wrong flow when you just need a student in the system, so
// this is the direct path: fill in a form, get a student, exactly the way a
// teacher or an admin is created (create-teacher-with-user / create-admin-with-user).
//
// What this deliberately does NOT do: no invoice, no payment link, no payment
// proof, no enrollment_requests row. Hours are added separately — and for a
// family, on the parent rather than the student (see the 2026-09-11 family
// packages migration).
//
// Deploy: supabase functions deploy create-student-with-user

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
function runInBackground(task: Promise<unknown>) {
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
}

// Same derivation every other role uses: username from the email's local part,
// password "<first name>@ascendnow" — memorable and typeable off an email,
// rather than a random string nobody can read out.
function usernameFromEmail(email: string) {
  return (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function passwordFromFirstName(firstName: string) {
  return `${(firstName || "user").trim().toLowerCase()}@ascendnow`;
}

async function uniqueUsername(serviceClient: ReturnType<typeof createClient>, base: string) {
  const root = base || "student";
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
    const {
      first_name,
      last_name = "",
      email,
      parent_id = null,
      pc_teacher_id = null,
      curriculum = null,
      school = null,
      phone_number = null,
      country = null,
      notification_email = null,
    } = body;

    const firstName = String(first_name ?? "").trim();
    const lastName = String(last_name ?? "").trim();
    const studentEmail = String(email ?? "").trim();

    if (!firstName || !studentEmail) {
      return json({ error: "first_name and email are required" }, 400);
    }

    // The guardian's name/phone are copied off the linked parent account, the
    // same rule the admin forms apply (applyParentToGuardianContact) — the
    // account is the source of truth for who the guardian is.
    let parentFullName: string | null = null;
    let parentPhone: string | null = null;
    if (parent_id) {
      const { data: parent, error: parentErr } = await serviceClient
        .from("parents")
        .select("id, first_name, last_name, phone_number")
        .eq("id", parent_id)
        .maybeSingle();
      if (parentErr) return json({ error: `Parent lookup failed: ${parentErr.message}` }, 400);
      if (!parent) return json({ error: `No parent found with id ${parent_id}` }, 404);
      parentFullName = `${parent.first_name} ${parent.last_name}`.trim();
      parentPhone = (parent.phone_number as string | null) ?? null;
    }

    const username = await uniqueUsername(serviceClient, usernameFromEmail(studentEmail));
    const password = passwordFromFirstName(firstName);
    const fullName = `${firstName}${lastName ? " " + lastName : ""}`;

    // 1. Auth account — trg_create_user_profile writes the public.users row.
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email: studentEmail,
      password,
      user_metadata: { username, full_name: fullName, role: "student" },
      email_confirm: true,
    });
    if (authError || !authData.user) return json({ error: authError?.message ?? "Failed to create login" }, 400);
    const newUserId = authData.user.id;

    // 2. The student row. The mnemonic id (BATO26-1) comes from
    //    trg_generate_student_id.
    const { data: student, error: studentErr } = await serviceClient
      .from("students")
      .insert({
        first_name: firstName,
        // students.last_name is NOT NULL, so an omitted surname is stored as
        // the empty string — the same thing the enrollment flow does, and the
        // first-login gate is where the student fills it in.
        last_name: lastName,
        email: studentEmail,
        notification_email: notification_email || studentEmail,
        parent_id: parent_id || null,
        parent_full_name: parentFullName,
        parent_phone_number: parentPhone,
        curriculum: curriculum || null,
        school: school || null,
        phone_number: phone_number || null,
        country: country || null,
        user_id: newUserId,
      })
      .select()
      .single();

    if (studentErr || !student) {
      // Rollback: an orphaned auth account would block this email forever.
      await serviceClient.auth.admin.deleteUser(newUserId);
      return json({ error: studentErr?.message ?? "Failed to create student" }, 400);
    }

    // 3. The Performance Coach assignment, when one was picked. Non-fatal: the
    //    student exists either way and an admin can assign a coach afterwards,
    //    which is better than rolling back a good account over it.
    if (pc_teacher_id) {
      const { error: pcErr } = await serviceClient.from("pc_student_assignments").insert({
        student_id: student.id,
        pc_teacher_id,
      });
      if (pcErr) console.error("Failed to assign performance coach:", pcErr.message);
    }

    // 4. Credentials email — backgrounded, and non-fatal: the admin can read
    //    the username/password straight off the response either way.
    runInBackground(
      sendWelcomeEmail({ first_name: firstName, last_name: lastName, email: studentEmail, username, password })
        .catch((emailErr) => console.error("Failed to send student welcome email:", emailErr))
    );

    return json({ data: { student, credentials: { username, password } } });
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
<p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi <strong>${fullName}</strong>, your Ascend Now student account has been created. Here are your login details:</p>
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

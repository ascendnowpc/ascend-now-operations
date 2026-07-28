// Supabase Edge Function: update-user-email
// Changes a user's email everywhere it lives, atomically-ish:
//   1. auth.users.email (the real Supabase Auth login credential + the
//      address password-reset / magic-link mails go to) — via the admin API,
//      with email_confirm so it takes effect immediately (no confirmation
//      round-trip the app isn't set up to walk a user through).
//   2. public.users.email (what get_email_for_username resolves for
//      username-based login, and the sidebar identity badge).
//   3. public.teachers.email (contact info), when the target user has a
//      teacher row.
//
// Before this existed, the profile page changed public.users.email /
// teachers.email but never auth.users.email, so after any email change the
// username -> email login resolver returned an address Auth didn't recognise
// and the account was locked out. This keeps all three in lockstep.
//
// Callers:
//   * self-service — any authenticated user may change their OWN email
//     (targetUserId omitted or equal to the caller).
//   * admin — an admin may change ANY user's email by passing targetUserId.
//
// Deploy: supabase functions deploy update-user-email

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    // Identify the caller from their JWT.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const newEmailRaw = typeof body.newEmail === "string" ? body.newEmail.trim() : "";
    const targetUserId: string = body.targetUserId || caller.id;

    if (!newEmailRaw || !EMAIL_RE.test(newEmailRaw)) {
      return json({ error: "A valid email address is required." }, 400);
    }
    const newEmail = newEmailRaw.toLowerCase();

    // Authorisation: a user may change only their own email unless they're an
    // admin (admins may change anyone's).
    if (targetUserId !== caller.id) {
      const { data: callerProfile } = await callerClient
        .from("users")
        .select("role")
        .eq("id", caller.id)
        .single();
      if (!callerProfile || callerProfile.role !== "admin") {
        return json({ error: "Forbidden — you can only change your own email." }, 403);
      }
    }

    // Service-role client for the privileged Auth + table writes.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Reject if some OTHER account already uses this email as its login
    // identity (auth emails are unique; a clear message beats a raw 500).
    const { data: existing } = await serviceClient
      .from("users")
      .select("id")
      .ilike("email", newEmail)
      .neq("id", targetUserId)
      .maybeSingle();
    if (existing) {
      return json({ error: "That email address is already in use by another account." }, 409);
    }

    // 1. Auth login credential — takes effect immediately (email_confirm).
    const { error: authErr } = await serviceClient.auth.admin.updateUserById(targetUserId, {
      email: newEmail,
      email_confirm: true,
    });
    if (authErr) return json({ error: authErr.message }, 400);

    // 2. public.users.email (login resolver + identity badge).
    const { error: usersErr } = await serviceClient
      .from("users")
      .update({ email: newEmail })
      .eq("id", targetUserId);
    if (usersErr) return json({ error: usersErr.message }, 400);

    // 3. public.teachers.email (contact info) — only if a teacher row exists.
    await serviceClient
      .from("teachers")
      .update({ email: newEmail })
      .eq("user_id", targetUserId);

    return json({ ok: true, email: newEmail });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

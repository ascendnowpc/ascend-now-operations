// Supabase Edge Function: deactivate-teacher-with-user
// Admin-only. Deactivates a teacher (and their login), refusing to do so if
// they're a performance coach who still has students actively assigned
// (pc_student_assignments with no unassigned_at) — those must be reassigned
// first from /admin/pc-assignments. A plain client-side
// `teachers.update({ is_active: false })` couldn't enforce that check.
//
// Deliberately does NOT touch the teacher's login email in any way: an
// earlier version freed it up (renamed to a parked address) so a new
// teacher could reuse it, but that made reactivating the old account later
// come back with a broken email while the real address belonged to someone
// else — teachers.email stays globally unique and deactivation is fully
// reversible.
//
// Required: caller must be an authenticated admin.
//
// Deploy: supabase functions deploy deactivate-teacher-with-user

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { teacher_id } = await req.json();
    if (!teacher_id) return json({ error: "teacher_id is required" }, 400);

    const { data: teacher, error: teacherErr } = await serviceClient
      .from("teachers")
      .select("*")
      .eq("id", teacher_id)
      .single();
    if (teacherErr || !teacher) {
      return json({ error: teacherErr ? `Teacher lookup failed: ${teacherErr.message}` : "Teacher not found" }, 404);
    }

    if (!teacher.is_active) {
      return json({ success: true, alreadyInactive: true });
    }

    const { count, error: assignErr } = await serviceClient
      .from("pc_student_assignments")
      .select("id", { count: "exact", head: true })
      .eq("pc_teacher_id", teacher_id)
      .is("unassigned_at", null);
    if (assignErr) return json({ error: `Failed to check assigned students: ${assignErr.message}` }, 500);
    if (count && count > 0) {
      return json({
        error: `Can't deactivate — ${count} student${count !== 1 ? "s are" : " is"} still assigned to this coach. Reassign them from PC Assignments first.`,
      }, 400);
    }

    const { error: updateErr } = await serviceClient
      .from("teachers")
      .update({ is_active: false })
      .eq("id", teacher_id);
    if (updateErr) return json({ error: updateErr.message }, 400);

    if (teacher.user_id) {
      const { error: userErr } = await serviceClient
        .from("users")
        .update({ is_active: false })
        .eq("id", teacher.user_id);
      // Surface (don't swallow) a failure to sync the login row: leaving
      // users.is_active = true while teachers.is_active = false is exactly the
      // desync that made deactivated teachers still show as "Active" on
      // /admin/users. The teacher is already marked inactive above, so report
      // the partial state rather than a bare success.
      if (userErr) {
        return json({ error: `Teacher deactivated, but failed to disable their login: ${userErr.message}` }, 500);
      }
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

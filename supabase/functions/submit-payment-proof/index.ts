// Supabase Edge Function: submit-payment-proof
// Public (no login) endpoint behind the /pay/:token page. The parent has no
// Supabase Auth session — the unguessable token in the URL is what
// authorizes this. Two modes:
//   GET  ?token=...            -> read-only invoice summary (every package
//                                 on the request + how many proofs already
//                                 uploaded) + current status
//   POST multipart/form-data   -> { token, file (one or more) } upload one
//                                 or more payment screenshots in a single
//                                 request — a parent who paid in separate
//                                 transactions can attach one file per
//                                 payment instead of being limited to one
//                                 screenshot for the whole request.
//
// Uploads go straight to the private `payment-proofs` bucket via the
// service-role key (there's no authenticated session to satisfy storage
// RLS with), which is why this must stay a narrow, token-gated endpoint
// rather than exposing the bucket to anon uploads directly.
//
// Required edge function secrets:
//   (uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, already available to
//   every edge function in this project)
//
// Deploy: supabase functions deploy submit-payment-proof --no-verify-jwt

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESUBMITTABLE_STATUSES = ["pending_payment", "rejected"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token");
      if (!token) return json({ error: "token is required" }, 400);

      const { data: enrollment, error } = await serviceClient
        .from("enrollment_requests")
        .select("id, enrollment_type, first_name, last_name, parent_full_name, note, status, rejection_reason")
        .eq("payment_link_token", token)
        .single();

      if (error || !enrollment) return json({ error: "Invalid or expired payment link" }, 404);

      const { data: packages, error: packagesErr } = await serviceClient
        .from("enrollment_request_packages")
        .select("course_type_id, hours, package_size_label")
        .eq("enrollment_request_id", enrollment.id)
        .order("sort_order", { ascending: true });
      if (packagesErr) return json({ error: `Failed to load packages: ${packagesErr.message}` }, 500);

      const { count: proofCount, error: proofCountErr } = await serviceClient
        .from("enrollment_request_payment_proofs")
        .select("id", { count: "exact", head: true })
        .eq("enrollment_request_id", enrollment.id);
      if (proofCountErr) return json({ error: `Failed to load payment proofs: ${proofCountErr.message}` }, 500);

      // Resolved separately rather than via a `course_types(name)` embed —
      // this codebase has hit PostgREST embedding issues before (see
      // useInvoices.ts) and resolves relation names client-side instead.
      const { data: courseTypeRows } = await serviceClient
        .from("course_types")
        .select("id, name")
        .in("id", Array.from(new Set((packages ?? []).map((p) => p.course_type_id))));
      const courseTypeNameById = new Map((courseTypeRows ?? []).map((c) => [c.id as number, c.name as string]));

      return json({
        data: {
          ...enrollment,
          packages: (packages ?? []).map((p) => ({
            hours: p.hours,
            package_size_label: p.package_size_label,
            course_types: { name: courseTypeNameById.get(p.course_type_id) ?? "Package" },
          })),
          proof_count: proofCount ?? 0,
        },
      });
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const token = form.get("token");
      const files = form.getAll("file").filter((f): f is File => f instanceof File);

      if (typeof token !== "string" || !token) return json({ error: "token is required" }, 400);
      if (files.length === 0) return json({ error: "At least one file is required" }, 400);

      const { data: enrollment, error: findErr } = await serviceClient
        .from("enrollment_requests")
        .select("id, status")
        .eq("payment_link_token", token)
        .single();

      if (findErr || !enrollment) return json({ error: "Invalid or expired payment link" }, 404);
      if (!RESUBMITTABLE_STATUSES.includes(enrollment.status)) {
        return json({ error: "Payment proof has already been submitted for this request" }, 400);
      }

      // If a later file in this batch fails (or the DB insert below fails),
      // the files already uploaded in this same request are cleaned back up
      // rather than left as permanent orphans in the bucket with no
      // enrollment_request_payment_proofs row pointing at them.
      const uploadedPaths: string[] = [];
      for (const file of files) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${enrollment.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await serviceClient.storage
          .from("payment-proofs")
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (uploadErr) {
          if (uploadedPaths.length > 0) await serviceClient.storage.from("payment-proofs").remove(uploadedPaths);
          return json({ error: uploadErr.message }, 400);
        }
        uploadedPaths.push(path);
      }

      const { error: proofInsertErr } = await serviceClient
        .from("enrollment_request_payment_proofs")
        .insert(uploadedPaths.map((storage_path) => ({ enrollment_request_id: enrollment.id, storage_path })));
      if (proofInsertErr) {
        await serviceClient.storage.from("payment-proofs").remove(uploadedPaths);
        return json({ error: proofInsertErr.message }, 400);
      }

      const { error: updateErr } = await serviceClient
        .from("enrollment_requests")
        .update({ status: "payment_submitted", rejection_reason: null })
        .eq("id", enrollment.id);

      if (updateErr) return json({ error: updateErr.message }, 400);
      return json({ success: true, uploaded: uploadedPaths.length });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

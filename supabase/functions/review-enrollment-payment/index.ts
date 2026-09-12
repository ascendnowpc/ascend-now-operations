// Supabase Edge Function: review-enrollment-payment
// Admin-only. Reviews an uploaded payment screenshot and either confirms or
// rejects it.
//
// A single request can carry more than one package line item (added
// 2026-07-25, enrollment_request_packages) — an admin selling/renewing
// several packages for one student at once. Confirm processes every line
// item independently (its own pool/package resolution, stamped back onto
// that line's own row) but still sends exactly one combined confirmation
// email and runs one finalize/reject/resend flow at the request level.
//
// On confirm:
//   - new_student: creates the students row and a SINGLE auth.users/
//     public.users login — the student account (student_email, role student).
//     The guardian's name/phone are kept as plain fields on the student row,
//     and a "send updates to" notification_email (which may match or differ
//     from the login email) is recorded. If the enroll form picked a parent
//     ACCOUNT, its id is copied onto the student too (2026-09-10) — that
//     login is created separately by create-parent-with-user, never here.
//     Also creates a fresh student_package (or bundle of pools, see below)
//     and a package_topups row per package line; emails the student their
//     credentials + one combined package confirmation.
//   - renewal: tops up the student's existing *unlocked* package for each
//     line's course type, or — if it doesn't have one (never had one, or the
//     only one is locked) — starts a brand-new package generation that
//     inherits the prior generation's bundle/pool membership (package_type_id
//     / pool_label) so a bundled pool stays in its bundle; emails one combined
//     renewal confirmation (no credentials, the student already has an account).
//   - bundle course types (Foundation Program / All-In-One): the same
//     unlocked-tops-up / locked-starts-fresh rule applies per pool, not to
//     a single package — pool hours come from bundle_pool_settings (admin-
//     editable via Admin → Reports → Settings), not a hardcoded constant.
//     A first-time bundle purchase (line.is_bundle_pool_selection = false) creates/tops
//     up every pool in the bundle at its own fixed hours; once the bundle
//     is already owned, the enroll form forces picking exactly one pool
//     (bundle_pool_label) and only that pool receives the line's hours.
//   - SHARED lines (line.is_shared, 2026-09-12): the pool is owned by the
//     student's PARENT instead of the student, and drawn on by exactly two
//     named children — this student plus whoever the line's
//     enrollment_request_package_members rows name. Only the others are
//     stored, because on a new-student enrollment this student has no id
//     until the block below creates them. Bundles are never shareable.
//
// On reject: sets status to 'rejected' (stays visibly rejected, does not
// silently revert to pending_payment) and emails the reason + payment link
// so the parent can re-upload. The admin can supply their own custom
// rejection note; a sensible default is used if they don't.
//
// resend_rejection: for an already-rejected request, re-sends the exact
// same rejection email (reason + payment link) without changing anything —
// used by the Enrollments queue's "Resend Email" button on rejected rows.
//
// Required edge function secrets:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//   PUBLIC_APP_URL
//
// Deploy: supabase functions deploy review-enrollment-payment

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Runs a non-critical task (here, confirmation/rejection emails whose
// outcome the response doesn't depend on) after the response has already
// been prepared, instead of making the caller wait on one or more SMTP
// round trips. EdgeRuntime.waitUntil (Deno Deploy / Supabase Edge Functions)
// keeps the isolate alive until the task settles even though the response
// was already sent — without it, work kicked off but not awaited can get
// cut off the moment the response goes out.
const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
function runInBackground(task: Promise<unknown>) {
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
}

// Mirrors the teacher-creation defaults (AdminTeacherFormPage.tsx): username
// is the email's local part, password is "<first name>@ascendnow" — both
// memorable, human-typeable, and consistent across every role instead of a
// random hex string nobody could actually read off an email and type in.
function usernameFromEmail(email: string) {
  return (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function passwordFromFirstName(firstName: string) {
  return `${(firstName || "user").trim().toLowerCase()}@ascendnow`;
}

// users.username is UNIQUE — the email-local-part base is usually unique on
// its own, but two different families/emails can share one (e.g. a shared
// "info@" address, or the same local part on different domains). Falls back
// to appending a counter only if the plain base is already taken.
async function uniqueUsername(serviceClient: ReturnType<typeof createClient>, base: string) {
  const root = base || "user";
  let candidate = root;
  let n = 2;
  while (true) {
    const { data } = await serviceClient.from("users").select("id").eq("username", candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${root}${n}`;
    n += 1;
  }
}

// Bundle course types (Foundation Program / All-In-One) don't create a
// single package — they fan out into several labeled pools, each deducting
// against its own real course_type (Beyond Academic / College Counselling)
// and grouped under the bundle via student_packages.package_type_id. Pool
// hours are read from bundle_pool_settings (see below) rather than a
// hardcoded object — admin-editable from Admin → Reports → Settings only,
// with AdminEnrollStudentPage.tsx reading the same table just to preview.

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

    const { enrollment_request_id, action, rejection_reason } = await req.json();
    if (!enrollment_request_id || !["confirm", "reject", "resend_rejection"].includes(action)) {
      return json({ error: "enrollment_request_id and action ('confirm' | 'reject' | 'resend_rejection') are required" }, 400);
    }

    const { data: enrollment, error: enrollErr } = await serviceClient
      .from("enrollment_requests")
      .select("*")
      .eq("id", enrollment_request_id)
      .single();

    if (enrollErr || !enrollment) {
      return json({ error: enrollErr ? `Enrollment lookup failed: ${enrollErr.message}` : "Enrollment request not found" }, 404);
    }

    if (action === "resend_rejection" && enrollment.status !== "rejected") {
      return json({ error: `Cannot resend a rejection notice — this request is currently '${enrollment.status}', not rejected.` }, 400);
    }
    if (["confirm", "reject"].includes(action) && enrollment.status !== "payment_submitted") {
      return json({ error: `Cannot review — this request is currently '${enrollment.status}', not awaiting review.` }, 400);
    }

    const publicAppUrl = Deno.env.get("PUBLIC_APP_URL");
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;
    const fullName = `${enrollment.first_name} ${enrollment.last_name}`.trim();

    // Accepts an already-open `sharedClient` so a caller sending several
    // emails in one go (e.g. student + parent credentials, or a renewal's
    // several recipients) can reuse one SMTP connection instead of paying a
    // fresh TLS handshake per recipient; callers sending just one email
    // (rejection notices) can omit it and get a one-off connection as before.
    async function sendMail(to: string, subject: string, html: string, sharedClient?: SMTPClient) {
      if (!smtpHost || !smtpUser || !smtpPass) {
        console.error("SMTP secrets missing — skipping email send");
        return;
      }
      const client = sharedClient ?? new SMTPClient({
        connection: { hostname: smtpHost, port: smtpPort, tls: true, auth: { username: smtpUser, password: smtpPass } },
      });
      await client.send({ from: `Ascend Now <${smtpFrom}>`, to, subject, html });
      if (!sharedClient) await client.close();
    }

    async function sendRejectionMail(reason: string) {
      const paymentUrl = publicAppUrl ? `${publicAppUrl.replace(/\/$/, "")}/pay/${enrollment.payment_link_token}` : null;
      await sendMail(
        enrollment.email,
        "Ascend Now - Payment Could Not Be Verified",
        `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">
<div style="background:#7f1d1d;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#fca5a5;text-transform:uppercase;letter-spacing:1px;">Ascend Now</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Payment Could Not Be Verified</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 16px;font-size:14px;color:#475569;">Hi <strong>${fullName}</strong>, we weren't able to verify your recent payment submission.</p>
<p style="margin:0 0 16px;font-size:14px;color:#475569;"><strong>Reason:</strong> ${reason}</p>
${paymentUrl ? `<div style="text-align:center;margin:24px 0 8px;"><a href="${paymentUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">Re-upload Payment Proof</a></div>` : ""}
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`
      );
    }

    if (action === "resend_rejection") {
      try {
        await sendRejectionMail(enrollment.rejection_reason ?? "Payment could not be verified.");
      } catch (emailErr) {
        console.error("Failed to resend rejection email:", emailErr);
        return json({ error: "Failed to send email — check SMTP configuration." }, 500);
      }
      return json({ success: true, status: "rejected" });
    }

    if (action === "reject") {
      const reason = rejection_reason ?? "Payment could not be verified.";
      const { error: updateErr } = await serviceClient
        .from("enrollment_requests")
        .update({ status: "rejected", rejection_reason: reason })
        .eq("id", enrollment.id);
      if (updateErr) return json({ error: updateErr.message }, 400);

      // Non-fatal either way (the row is already updated) — sent in the
      // background so the admin isn't stuck waiting on an SMTP connection.
      runInBackground(sendRejectionMail(reason).catch((emailErr) => console.error("Failed to send rejection email:", emailErr)));
      return json({ success: true, status: "rejected" });
    }

    // action === "confirm" — load every package line item on this request.
    const { data: packages, error: packagesErr } = await serviceClient
      .from("enrollment_request_packages")
      .select("*")
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

    // Guard against a hazard unique to multi-package requests, checked here
    // (before any write) so it fails fast with zero side effects: two lines
    // targeting the same bundle course type (Foundation Program / All-In-One)
    // both in "create the whole bundle fresh" mode (is_bundle_pool_selection
    // = false — what every line defaults to when the enroll form didn't
    // already own the bundle at fill-in time). Bundle creation isn't
    // idempotent across lines within one confirm — the second line's
    // applyBundlePool would find the pools the first just created and top
    // them up a second time at their default hours, silently doubling the
    // student's hours. Legitimate multi-line cases (topping up two different
    // pools of an already-owned bundle, or two lines of the same standalone
    // course type, which just add two topups to the same package) aren't
    // affected — this only blocks the specific double-create shape.
    const { data: bundleNameRows } = await serviceClient
      .from("bundle_pool_settings")
      .select("bundle_name")
      .in("bundle_name", Array.from(new Set(Array.from(courseTypeNameById.values()))));
    const bundleNames = new Set((bundleNameRows ?? []).map((r) => r.bundle_name as string));
    const freshBundleCourseTypeIds = packages
      .filter((p) => !p.is_bundle_pool_selection && bundleNames.has(courseTypeNameById.get(p.course_type_id) ?? ""))
      .map((p) => p.course_type_id);
    const duplicateFreshBundleId = freshBundleCourseTypeIds.find((id, i) => freshBundleCourseTypeIds.indexOf(id) !== i);
    if (duplicateFreshBundleId != null) {
      const name = courseTypeNameById.get(duplicateFreshBundleId) ?? "this bundle";
      return json({ error: `This request has more than one "${name}" package line both creating the bundle fresh — remove the duplicate (only one line can create a new bundle; combine their hours, or pick a specific pool to top up on the others instead).` }, 400);
    }

    let studentId = enrollment.student_id as string | null;
    let credentials: { username: string; password: string } | null = null;

    // A student has exactly one login of their own. It's created from
    // `student_email` — the address that becomes the username — falling back
    // to `email` (the "send updates to" notification address) only for a
    // legacy request that never captured a separate student email.
    // `notificationEmail` is where every non-credential mail goes
    // (invoice/renewal/threshold), falling back to the student's own login
    // email when it's blank. A parent account, when the family has one, is a
    // separate login entirely — see parent_id below.
    const studentEmail = ((enrollment.student_email as string | null) ?? enrollment.email ?? "").trim();
    const notificationEmail = ((enrollment.notification_email as string | null) ?? enrollment.email ?? studentEmail ?? "").trim();

    if (enrollment.enrollment_type === "new_student") {
      if (studentId) return json({ error: "This enrollment already has a student linked — inconsistent state." }, 400);

      const username = await uniqueUsername(serviceClient, usernameFromEmail(studentEmail));
      const password = passwordFromFirstName(enrollment.first_name);

      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email: studentEmail,
        password,
        user_metadata: { username, full_name: fullName, role: "student" },
        email_confirm: true,
      });
      if (authError || !authData.user) return json({ error: authError?.message ?? "Failed to create login" }, 400);
      const newUserId = authData.user.id;

      const { data: student, error: studentErr } = await serviceClient
        .from("students")
        .insert({
          first_name: enrollment.first_name,
          last_name: enrollment.last_name,
          // Guardian name + phone stay plain contact fields on the student
          // row, independent of the parent ACCOUNT below — a family can have
          // one, the other, or both.
          parent_full_name: enrollment.parent_full_name,
          parent_phone_number: enrollment.phone_number,
          // The parent account picked on the enroll form, if any. Its login
          // and credentials email were handled up front by
          // create-parent-with-user, so there is nothing to create here — the
          // student just joins the household, which is what makes their data
          // visible on that parent's dashboard (can_view_student, 2026-09-10).
          parent_id: enrollment.parent_id ?? null,
          email: studentEmail,
          // The "send updates to" address; may match the student email or
          // differ. Falls back to the student email when left blank.
          notification_email: notificationEmail || studentEmail,
          curriculum: enrollment.curriculum,
          report_card_url: enrollment.report_card_url,
          // enrollment.student_phone_number is the student's own phone,
          // distinct from the guardian phone stored above.
          phone_number: enrollment.student_phone_number,
          address: enrollment.address,
          country: enrollment.country,
          graduation_year: enrollment.graduation_year,
          birthday: enrollment.birthday,
          school: enrollment.school,
          user_id: newUserId,
        })
        .select()
        .single();

      if (studentErr || !student) {
        await serviceClient.auth.admin.deleteUser(newUserId);
        return json({ error: studentErr?.message ?? "Failed to create student" }, 400);
      }

      studentId = student.id as string;
      credentials = { username, password };

      // Every student needs an assigned Performance Coach — required at
      // enrollment-request submission time for new students (DB check
      // constraint), so this should always be set here.
      if (enrollment.pc_teacher_id) {
        await serviceClient.from("pc_student_assignments").insert({
          student_id: studentId,
          pc_teacher_id: enrollment.pc_teacher_id,
        });
      }
    }

    if (!studentId) return json({ error: "No student associated with this renewal — inconsistent state." }, 400);

    // ── Shared package lines ──────────────────────────────────────────────
    // A line marked is_shared becomes a PARENT-owned pool drawn on by named
    // children instead of a student-owned one. The line stores only the OTHER
    // children; the student this request is for is always a member, and on a
    // new-student enrollment that is the student created just above — which is
    // exactly why they are added here rather than at request time.
    //
    // Everything below runs before the first package write, so a request that
    // could not produce a valid shared pool fails with zero side effects
    // rather than half-creating packages the family has already paid for.
    //
    // 2 is the business rule "2 students per programme". It also lives in
    // validate_student_package_member() (SQL) and SHARED_PACKAGE_STUDENT_COUNT
    // (src/utils/sharedPackages.ts) — change all three together.
    const SHARED_PACKAGE_STUDENT_COUNT = 2;
    const sharedLines = packages.filter((p) => p.is_shared);
    const memberIdsByLine = new Map<string, string[]>();
    const coSharerNameById = new Map<string, string>();
    let householdParentId: string | null = null;

    if (sharedLines.length > 0) {
      const { data: studentRow, error: studentLookupErr } = await serviceClient
        .from("students")
        .select("parent_id")
        .eq("id", studentId)
        .single();
      if (studentLookupErr || !studentRow) {
        return json({ error: `Failed to look up the student's household: ${studentLookupErr?.message ?? "not found"}` }, 400);
      }
      householdParentId = (studentRow.parent_id as string | null) ?? null;
      if (!householdParentId) {
        return json({ error: "This request has a shared package, but the student has no parent account to own it. Link the family first, or sell the package individually." }, 400);
      }

      const { data: coSharerRows, error: coSharerErr } = await serviceClient
        .from("enrollment_request_package_members")
        .select("enrollment_request_package_id, student_id")
        .in("enrollment_request_package_id", sharedLines.map((p) => p.id));
      if (coSharerErr) return json({ error: `Failed to load shared-package members: ${coSharerErr.message}` }, 400);

      // Every co-sharer must still be a child of this household — a sibling
      // can have been moved or deleted between invoicing and payment.
      const coSharerIds = Array.from(new Set((coSharerRows ?? []).map((r) => r.student_id as string)));
      if (coSharerIds.length > 0) {
        const { data: coSharerStudents, error: coSharerStudentsErr } = await serviceClient
          .from("students")
          .select("id, first_name, parent_id")
          .in("id", coSharerIds);
        if (coSharerStudentsErr) return json({ error: `Failed to check shared-package members: ${coSharerStudentsErr.message}` }, 400);
        const found = new Map((coSharerStudents ?? []).map((c) => [c.id as string, c]));
        for (const id of coSharerIds) {
          const child = found.get(id);
          if (!child) return json({ error: `Student ${id} was named on a shared package but no longer exists.` }, 400);
          if (child.parent_id !== householdParentId) {
            return json({ error: `${child.first_name} (${id}) is no longer in this family and cannot share a package with this student.` }, 400);
          }
          coSharerNameById.set(id, child.first_name as string);
        }
      }

      for (const line of sharedLines) {
        const members = Array.from(new Set([
          studentId,
          ...(coSharerRows ?? [])
            .filter((r) => r.enrollment_request_package_id === line.id)
            .map((r) => r.student_id as string),
        ]));
        if (members.length !== SHARED_PACKAGE_STUDENT_COUNT) {
          return json({ error: `The shared package "${line.package_size_label}" names ${members.length} student(s); a shared package is shared by exactly ${SHARED_PACKAGE_STUDENT_COUNT}.` }, 400);
        }
        memberIdsByLine.set(line.id as string, members);
      }
    }

    // Applies one bundle pool definition: tops up its existing *unlocked*
    // pool of the same (course_type, pool_label) — same match the
    // standalone branch below uses — or starts a fresh one if that pool was
    // locked or never existed. `note`/`addedByUserId` are shared across
    // every package line on this request (there's no per-package note).
    async function applyBundlePool(
      ctIdByName: Map<string, number>,
      bundleCourseTypeId: number,
      pool: { label: string | null; courseTypeName: string; hours: number },
      hoursToAdd: number,
      packageSizeLabel: string
    ) {
      const poolCourseTypeId = ctIdByName.get(pool.courseTypeName);
      if (poolCourseTypeId == null) {
        return { error: `Bundle pool course type "${pool.courseTypeName}" not found in course_types.` } as const;
      }

      let poolQuery = serviceClient
        .from("student_packages")
        .select("id")
        .eq("student_id", studentId!)
        .eq("course_type_id", poolCourseTypeId)
        .eq("is_locked", false);
      poolQuery = pool.label == null ? poolQuery.is("pool_label", null) : poolQuery.eq("pool_label", pool.label);
      const { data: existingPool } = await poolQuery.maybeSingle();

      let poolPackageId: number;
      let wasNew = false;
      if (existingPool) {
        poolPackageId = existingPool.id;
        // The match is on (course_type, pool_label) only, so it can land on a
        // package that was bought *standalone* (package_type_id null) before
        // this bundle was — e.g. a standalone College Counselling package that
        // predates an All-In-One purchase. A bundle operation must promote it
        // into the bundle, otherwise it keeps rendering outside the bundle even
        // though its hours came from the bundle. Set unconditionally: it's an
        // idempotent no-op when the row is already in this bundle, and the
        // one-current-per-(student,course_type,pool_label) index guarantees it
        // can't belong to a different unlocked bundle. (A plain != filter would
        // skip the null-package_type_id rows this is meant to fix, since
        // `null != 7` is null, not true, in Postgres.)
        const { error: promoteErr } = await serviceClient
          .from("student_packages")
          .update({ package_type_id: bundleCourseTypeId })
          .eq("id", poolPackageId);
        if (promoteErr) {
          return { error: `Bundle pool "${pool.label ?? pool.courseTypeName}" exists (id ${poolPackageId}) but adding it to the bundle failed: ${promoteErr.message}` } as const;
        }
      } else {
        const { data: newPool, error: newPoolErr } = await serviceClient
          .from("student_packages")
          .insert({
            student_id: studentId,
            course_type_id: poolCourseTypeId,
            package_type_id: bundleCourseTypeId,
            pool_label: pool.label,
          })
          .select()
          .single();
        if (newPoolErr || !newPool) {
          return { error: `Creating bundle pool "${pool.label ?? pool.courseTypeName}" failed: ${newPoolErr?.message}` } as const;
        }
        poolPackageId = newPool.id;
        wasNew = true;
      }

      const { error: poolTopupErr } = await serviceClient.from("package_topups").insert({
        student_package_id: poolPackageId,
        hours_added: hoursToAdd,
        package_size_label: `${packageSizeLabel} — ${pool.label ?? pool.courseTypeName}`,
        note: enrollment.note,
        added_by_user_id: user.id,
      });
      if (poolTopupErr) {
        return { error: `Bundle pool "${pool.label ?? pool.courseTypeName}" exists (id ${poolPackageId}) but adding hours failed: ${poolTopupErr.message}` } as const;
      }

      return { packageId: poolPackageId, wasNew, error: null } as const;
    }

    // Processes exactly one package line item — standalone package or
    // bundle (Foundation Program / All-In-One) — returning which
    // student_packages row it resolved to (created or topped up).
    async function processPackageLine(pkg: {
      id: string;
      course_type_id: number;
      program_type_id: number | null;
      hours: number;
      package_size_label: string;
      is_bundle_pool_selection: boolean;
      bundle_pool_label: string | null;
      is_shared: boolean;
    }): Promise<{ error: string } | { targetPackageId: number; isNewGeneration: boolean }> {
      const courseTypeName = courseTypeNameById.get(pkg.course_type_id) ?? "Package";
      // Resolved above, before any write; both are set together or not at all.
      const memberIds = pkg.is_shared ? memberIdsByLine.get(pkg.id) ?? [] : [];

      // bundle_pool_settings is keyed by the bundle's course_type name
      // (bundle_name), resolved the same way courseTypeName above already
      // was — admin-editable hours, never hardcoded here.
      const { data: bundlePoolRows, error: bundlePoolErr } = await serviceClient
        .from("bundle_pool_settings")
        .select("pool_label, course_type_name, hours")
        .eq("bundle_name", courseTypeName)
        .order("sort_order", { ascending: true });
      if (bundlePoolErr) return { error: `Failed to load bundle pool settings: ${bundlePoolErr.message}` };
      const bundleDefs = bundlePoolRows && bundlePoolRows.length > 0
        ? bundlePoolRows.map((r) => ({
            label: r.pool_label as string | null,
            courseTypeName: r.course_type_name as string,
            hours: Number(r.hours),
          }))
        : undefined;

      if (bundleDefs) {
        // A bundle contains a College Counselling pool, which is bought per
        // student, so no bundle course type is is_shareable and this is
        // unreachable through the form. Stated rather than assumed, because
        // applyBundlePool below is student-owned throughout.
        if (pkg.is_shared) {
          return { error: `"${courseTypeName}" is a bundle and cannot be sold as a shared package.` };
        }
        const { data: poolCourseTypes, error: poolCtErr } = await serviceClient
          .from("course_types")
          .select("id, name")
          .in("name", Array.from(new Set(bundleDefs.map((d) => d.courseTypeName))));
        if (poolCtErr || !poolCourseTypes) {
          return { error: `Failed to resolve bundle pool course types: ${poolCtErr?.message ?? "not found"}` };
        }
        const ctIdByName = new Map(poolCourseTypes.map((c) => [c.name as string, c.id as number]));

        if (pkg.is_bundle_pool_selection) {
          // Targeted top-up of exactly one pool the admin picked at request
          // time (this bundle is already owned by the student) — don't touch
          // any other pool in the bundle. bundle_pool_label can itself be
          // null (a bundle's default/unlabeled pool is a valid target).
          const pool = bundleDefs.find((d) => (d.label ?? null) === (pkg.bundle_pool_label ?? null));
          if (!pool) {
            return { error: `Bundle pool "${pkg.bundle_pool_label ?? "(default)"}" is not part of the "${courseTypeName}" bundle definition.` };
          }
          const result = await applyBundlePool(ctIdByName, pkg.course_type_id, pool, pkg.hours, pkg.package_size_label);
          if (result.error) return { error: result.error };
          return { targetPackageId: result.packageId, isNewGeneration: result.wasNew };
        }

        // First-time bundle purchase: create/top up every pool using its
        // own fixed default hours.
        let lastPackageId: number | null = null;
        let anyExisting = false;
        let anyNew = false;

        for (const pool of bundleDefs) {
          const result = await applyBundlePool(ctIdByName, pkg.course_type_id, pool, pool.hours, pkg.package_size_label);
          if (result.error) return { error: result.error };
          lastPackageId = result.packageId;
          if (result.wasNew) anyNew = true; else anyExisting = true;
        }

        // Only a "clean" new generation if every pool in the bundle was
        // freshly created — reusing even one existing unlocked pool means
        // this was a partial renewal, not a fresh start.
        return { targetPackageId: lastPackageId!, isNewGeneration: anyNew && !anyExisting };
      }

      // Which owner's pools this line looks at, creates under, and renews.
      // The only difference between a shared and an individual line is this
      // one column — hours, labels, bundles and the renewal-vs-new-generation
      // rule below are identical.
      const ownerColumn = pkg.is_shared ? "parent_id" : "student_id";
      const ownerId = pkg.is_shared ? householdParentId! : studentId!;
      const ownerColumns = pkg.is_shared
        ? { parent_id: householdParentId }
        : { student_id: studentId };

      // Current (unlocked) package of this owner's for this course type, if any.
      const { data: currentPkg } = await serviceClient
        .from("student_packages")
        .select("*")
        .eq(ownerColumn, ownerId)
        .eq("course_type_id", pkg.course_type_id)
        .eq("is_locked", false)
        .maybeSingle();

      let targetPackageId: number;
      let isNewGeneration: boolean;
      if (currentPkg) {
        targetPackageId = currentPkg.id;
        isNewGeneration = false;

        // Topping up an existing shared pool only makes sense if it is shared
        // with the same children this line names. Adding hours to a pool two
        // OTHER siblings draw on would be invisible and irreversible, so it is
        // refused rather than guessed at.
        if (pkg.is_shared) {
          const { data: existingMembers, error: existingMembersErr } = await serviceClient
            .from("student_package_members")
            .select("student_id")
            .eq("student_package_id", targetPackageId);
          if (existingMembersErr) {
            return { error: `Failed to read who shares the existing pool: ${existingMembersErr.message}` };
          }
          const have = (existingMembers ?? []).map((m) => m.student_id as string).sort();
          const want = [...memberIds].sort();
          if (have.length !== want.length || have.some((id, i) => id !== want[i])) {
            return { error: `The family's existing ${courseTypeName} pool is shared by ${have.join(", ") || "nobody"}, but this line names ${want.join(", ")}. Lock the existing pool first, or sell this one to the same pair.` };
          }
        }
      } else {
        // No live package for this course type — this renewal starts a fresh
        // generation (the prior one was locked). It must inherit whatever
        // bundle (package_type_id) and pool (pool_label) the prior generation
        // belonged to, otherwise a bundled pool (e.g. College Counselling
        // inside the All-In-One bundle) silently becomes a standalone package
        // on renewal. A genuinely first-time standalone purchase has no prior
        // row, so both stay null.
        const { data: priorPkg } = await serviceClient
          .from("student_packages")
          .select("package_type_id, pool_label")
          .eq(ownerColumn, ownerId)
          .eq("course_type_id", pkg.course_type_id)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: newPkg, error: pkgErr } = await serviceClient
          .from("student_packages")
          .insert({
            ...ownerColumns,
            course_type_id: pkg.course_type_id,
            program_type_id: pkg.program_type_id,
            package_type_id: priorPkg?.package_type_id ?? null,
            pool_label: priorPkg?.pool_label ?? null,
          })
          .select()
          .single();
        if (pkgErr || !newPkg) return { error: `Package creation failed: ${pkgErr?.message}` };
        targetPackageId = newPkg.id;
        isNewGeneration = true;

        // Name the children on a brand-new shared pool before any hours land
        // on it: a parent-owned pool with no members is one nobody can spend,
        // and the session-log router would send their lessons to a zero-hour
        // fallback instead. Deleted again if this fails, so a half-made pool
        // never survives the confirm.
        if (pkg.is_shared) {
          const { error: memberErr } = await serviceClient
            .from("student_package_members")
            .insert(memberIds.map((id) => ({
              student_package_id: targetPackageId,
              student_id: id,
              added_by_user_id: user.id,
            })));
          if (memberErr) {
            await serviceClient.from("student_packages").delete().eq("id", targetPackageId);
            return { error: `Sharing the new ${courseTypeName} pool failed: ${memberErr.message}` };
          }
        }
      }

      const { error: topupErr } = await serviceClient.from("package_topups").insert({
        student_package_id: targetPackageId,
        hours_added: pkg.hours,
        package_size_label: pkg.package_size_label,
        note: enrollment.note,
        added_by_user_id: user.id,
      });
      if (topupErr) return { error: `Package exists (id ${targetPackageId}) but adding hours failed: ${topupErr.message}` };

      return { targetPackageId, isNewGeneration };
    }

    const processedPackages: {
      packageRowId: string;
      courseTypeId: number;
      courseTypeName: string;
      hours: number;
      packageSizeLabel: string;
      targetPackageId: number;
      isNewGeneration: boolean;
      /** "Shared with Elif" on a shared line, null on an individual one. */
      sharedWith: string | null;
    }[] = [];

    // Processed sequentially, not in parallel, on purpose: two lines can
    // legitimately target the same course type (e.g. two pools of the same
    // bundle), and their standalone/bundle-pool resolution queries-then-
    // creates a student_packages row keyed on (student_id, course_type_id,
    // is_locked=false) — a partial unique index enforces at most one such
    // row. Running two same-course-type lines concurrently would race two
    // "does it exist yet?" reads against that constraint instead of each
    // line safely observing the previous line's write.
    for (const pkg of packages) {
      const result = await processPackageLine(pkg);
      if ("error" in result) {
        return json({ error: `Package "${pkg.package_size_label}" (${courseTypeNameById.get(pkg.course_type_id) ?? "course type " + pkg.course_type_id}) failed: ${result.error}` }, 400);
      }
      processedPackages.push({
        packageRowId: pkg.id,
        courseTypeId: pkg.course_type_id,
        courseTypeName: courseTypeNameById.get(pkg.course_type_id) ?? "Package",
        hours: Number(pkg.hours),
        packageSizeLabel: pkg.package_size_label,
        targetPackageId: result.targetPackageId,
        isNewGeneration: result.isNewGeneration,
        // The confirmation email says who else can spend these hours. A
        // family reading "Academic — 50 hours" with no other mention would
        // reasonably think it was bought for one child.
        sharedWith: pkg.is_shared
          ? `Shared with ${(memberIdsByLine.get(pkg.id) ?? [])
              .filter((id) => id !== studentId)
              .map((id) => coSharerNameById.get(id) ?? id)
              .join(" and ")}`
          : null,
      });
    }

    // Stamp each package line's own result — a multi-package confirm can
    // create/top up several different student_packages rows, so this can no
    // longer live as one answer on the request itself.
    for (const p of processedPackages) {
      const { error: stampErr } = await serviceClient
        .from("enrollment_request_packages")
        .update({ resulting_student_package_id: p.targetPackageId, is_new_package_generation: p.isNewGeneration })
        .eq("id", p.packageRowId);
      if (stampErr) console.error(`Failed to stamp enrollment_request_packages row ${p.packageRowId}:`, stampErr);
    }

    const { error: finalizeErr } = await serviceClient
      .from("enrollment_requests")
      .update({
        status: "confirmed",
        confirmed_by_user_id: user.id,
        confirmed_at: new Date().toISOString(),
        student_id: studentId,
      })
      .eq("id", enrollment.id);
    if (finalizeErr) return json({ error: finalizeErr.message }, 400);

    // Auto-resolve any PC-submitted renewal requests matching (student,
    // course type) for every package line in this confirm — the invoice/
    // package flow just created the real thing a PC flagged as needed via
    // /teacher/renewal-requests. A renewal request is tied to one course
    // type, so each matching row is stamped with the resulting package from
    // the specific line that shares its course_type_id. Kept best-effort: a
    // failure here never blocks the confirm the admin is waiting on, since
    // the packages themselves are already correctly created.
    const resolvedRenewalRequests: { id: string; requested_by_teacher_id: string; courseTypeName: string; hours: number }[] = [];
    try {
      const { data: matching } = await serviceClient
        .from("package_renewal_requests")
        .select("id, requested_by_teacher_id, course_type_id")
        .eq("student_id", studentId)
        .in("course_type_id", Array.from(new Set(processedPackages.map((p) => p.courseTypeId))))
        .in("status", ["pending", "acknowledged"]);

      if (matching && matching.length > 0) {
        // Each renewal-request row can only ever be fulfilled by one package
        // line, even if two lines in this confirm share a course_type_id
        // (e.g. topping up two different pools of the same already-owned
        // bundle) — without this, both lines would re-match the same still-
        // "pending" row (matching isn't re-queried between iterations),
        // double-`UPDATE`ing it and emailing the requesting PC a duplicate
        // line item for what was really only one renewal request.
        const claimedIds = new Set<string>();
        for (const p of processedPackages) {
          const idsForThisLine = matching.filter((m) => m.course_type_id === p.courseTypeId && !claimedIds.has(m.id)).map((m) => m.id);
          if (idsForThisLine.length === 0) continue;
          idsForThisLine.forEach((id) => claimedIds.add(id));
          const { error: renewalUpdateErr } = await serviceClient
            .from("package_renewal_requests")
            .update({ status: "renewed", resulting_student_package_id: p.targetPackageId, renewed_at: new Date().toISOString() })
            .in("id", idsForThisLine);
          if (!renewalUpdateErr) {
            for (const m of matching.filter((mm) => idsForThisLine.includes(mm.id))) {
              resolvedRenewalRequests.push({ id: m.id, requested_by_teacher_id: m.requested_by_teacher_id, courseTypeName: p.courseTypeName, hours: p.hours });
            }
          }
        }
      }
    } catch (renewalErr) {
      console.error("Failed to auto-resolve package renewal requests:", renewalErr);
    }

    const credentialsRow = (label: string, value: string, shaded: boolean) =>
      `<tr${shaded ? ' style="background:#f8fafc;"' : ""}><td style="padding:10px 14px;color:#64748b;font-weight:600;width:120px;border:1px solid #e2e8f0;">${label}</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${value}</td></tr>`;

    // One row per package, alternating shading; a bold Total row is only
    // useful once there's more than one package to sum.
    const packageRowsHtml = processedPackages
      .map((p, i) => `<tr${i % 2 === 0 ? ' style="background:#f8fafc;"' : ""}>
<td style="padding:10px 14px;color:#64748b;font-weight:600;border:1px solid #e2e8f0;">${processedPackages.length > 1 ? `Package ${i + 1}` : "Package"}</td>
<td style="padding:10px 14px;border:1px solid #e2e8f0;">${p.courseTypeName} — ${p.packageSizeLabel} (${p.hours} hrs)${p.sharedWith ? `<br><span style="font-size:12px;color:#0284c7;">${p.sharedWith}</span>` : ""}</td>
</tr>`)
      .join("");
    const totalHours = processedPackages.reduce((sum, p) => sum + p.hours, 0);
    const totalRowHtml = processedPackages.length > 1
      ? `<tr style="background:#eff6ff;"><td style="padding:10px 14px;color:#1e3a5f;font-weight:700;border:1px solid #e2e8f0;">Total</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:700;color:#1e3a5f;">${totalHours} hrs across ${processedPackages.length} packages</td></tr>`
      : "";
    const packagePhrase = processedPackages.length > 1 ? "packages have" : "package has";

    // Confirmation emails are sent in the background (deferred via
    // runInBackground below) — the response the admin is waiting on
    // (studentId/packageIds/etc.) never depended on the email actually going
    // out, so there's no reason to make them wait on one or more SMTP round
    // trips first.
    const sendConfirmationEmails = async () => {
      // One shared connection for every email this confirm sends (student
      // credentials, renewal recipients, and any resolved-PC notices)
      // instead of a fresh TLS handshake per recipient.
      const sharedClient = (smtpHost && smtpUser && smtpPass)
        ? new SMTPClient({
            connection: { hostname: smtpHost, port: smtpPort, tls: true, auth: { username: smtpUser, password: smtpPass } },
          })
        : undefined;
      try {
        if (credentials) {
          // Student login → sent to the student's own email.
          const loginUrl = publicAppUrl ? `${publicAppUrl.replace(/\/$/, "")}/login` : null;
          await sendMail(
            studentEmail,
            "Welcome to Ascend Now - Your Student Login & Package Confirmation",
            `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Welcome aboard, ${fullName}!</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 16px;font-size:14px;color:#475569;">Your payment has been confirmed and the following ${packagePhrase} been added to your account:</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
${packageRowsHtml}
${totalRowHtml}
</table>
<p style="margin:0 0 12px;font-size:14px;color:#475569;">Here are your dashboard login details:</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
${credentialsRow("Student ID", String(studentId), true)}
${credentialsRow("Username", credentials.username, false)}
${credentialsRow("Password", credentials.password, true)}
</table>
${loginUrl ? `<div style="text-align:center;margin:20px 0 8px;"><a href="${loginUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">Log In to Ascend Now</a></div>` : ""}
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`,
            sharedClient
          );
        } else {
          // Renewal confirmation — sent to the "send updates to" address
          // (enrollment.email / notification_email) and the student's own
          // login email, deduped.
          const { data: studentRow } = await serviceClient.from("students").select("email, notification_email").eq("id", studentId).maybeSingle();
          const renewalRecipients = Array.from(
            new Set(
              [enrollment.email, enrollment.notification_email, enrollment.student_email, studentRow?.email, studentRow?.notification_email]
                .filter((e): e is string => !!e && e.trim().length > 0)
                .map((e) => e.trim().toLowerCase())
            )
          );
          for (const to of renewalRecipients) {
            await sendMail(
              to,
              "Ascend Now - Package Renewed",
              `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Package Renewed</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 16px;font-size:14px;color:#475569;">Hi <strong>${fullName}</strong>, your payment has been confirmed and the following ${packagePhrase} been added to your account. No new login is needed — use your existing dashboard account.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
${packageRowsHtml}
${totalRowHtml}
</table>
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`,
              sharedClient
            );
          }
        }

        // Tell every PC whose renewal request this confirm just fulfilled —
        // separate from (and in addition to) the student/parent confirmation
        // above, since a PC tracking their own request on
        // /teacher/renewal-requests has no other way to know it's done. One
        // email per PC even if this single confirm resolved more than one of
        // their requests (different course types).
        if (resolvedRenewalRequests.length > 0) {
          const pcIds = Array.from(new Set(resolvedRenewalRequests.map((r) => r.requested_by_teacher_id)));
          const { data: pcs } = await serviceClient.from("teachers").select("id, first_name, last_name, email").in("id", pcIds);
          for (const pc of pcs ?? []) {
            if (!pc.email) continue;
            const pcName = `${pc.first_name}${pc.last_name ? " " + pc.last_name : ""}`;
            const pcRequests = resolvedRenewalRequests.filter((r) => r.requested_by_teacher_id === pc.id);
            const itemsHtml = pcRequests.map((r) => `<li>${r.courseTypeName} — ${r.hours} hours added</li>`).join("");
            await sendMail(
              pc.email,
              `Ascend Now - Renewal Completed - ${fullName}`,
              `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">
<div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Ascend Now</p>
<h2 style="margin:6px 0 0;font-size:20px;color:#ffffff;">Renewal Completed</h2>
</div>
<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
<p style="margin:0 0 12px;font-size:14px;color:#475569;">Hi <strong>${pcName}</strong>, the package renewal${pcRequests.length > 1 ? "s" : ""} you requested for <strong>${fullName}</strong> (${studentId}) ${pcRequests.length > 1 ? "have" : "has"} been completed:</p>
<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#475569;">${itemsHtml}</ul>
<p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Sent by Ascend Now.</p>
</div>
</div>`,
              sharedClient
            );
          }
        }
      } finally {
        await sharedClient?.close();
      }
    };

    runInBackground(sendConfirmationEmails().catch((emailErr) => console.error("Failed to send confirmation email:", emailErr)));

    return json({
      success: true,
      studentId,
      packages: processedPackages.map((p) => ({
        packageRowId: p.packageRowId,
        studentPackageId: p.targetPackageId,
        isNewGeneration: p.isNewGeneration,
      })),
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

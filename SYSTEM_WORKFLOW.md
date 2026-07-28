# Ascend Now — System Walkthrough Script
**A guided script for demoing/explaining the whole system to someone new — last updated 2026-07-09**

This is a narration script, not a technical reference. It's meant to be read out loud (or followed step-by-step in the live app) to explain, from zero, how the system boots up, how each type of account gets created, and how data moves through it once people start using it. For exact columns/constraints/RLS, see `db/docs/VERIFIED_DATABASE_STATE.md`; for the full route map, see `README.md` §3.

Everything below reflects what's **actually built and live** as of this date — there's no hypothetical/future-tense material here.

---

## 0. The one-sentence pitch

> "Ascend Now runs tutoring operations end-to-end: coaches log sessions, hours get deducted from a student's purchased package automatically, invoices and monthly reports generate themselves from that data, and now a Gemini-powered homework generator lets a teacher turn a session or an uploaded PDF into a paper the student can attempt and get graded on — all behind role-based logins with database-enforced access control."

## 1. There is no public signup — say this first

Every single account in this system — admin, teacher, performance coach, or student — is created by *someone already inside the system*, never by self-registration. There's no "Sign up" button anywhere. This is deliberate (Key Decision #5 in `README.md` §4): it keeps the roster exactly matching who's actually a paying student or an employed teacher.

So the walkthrough naturally starts with: **who creates the very first account?**

---

## 2. Bootstrapping: creating the first Admin

Before anyone can log in and create anyone else, one admin has to exist. This is the one account type with no in-app "Create" button — it's done once, outside the UI:

```bash
cd db/scripts && node create-admin.mjs
```

(or: create a login via the Supabase Dashboard, then run `db/scripts/promote-user-to-admin.sql` against it.)

That script creates a Supabase Auth user, which fires the `create_user_profile()` trigger automatically — this trigger fires on **every** new `auth.users` row regardless of how it was created (script, Admin API, or Dashboard) and creates the matching `public.users` row. The script then inserts a row into `admins`. From here on, everything else happens through the app.

**Say:** "There's exactly one manual step in this whole system, and it's the very first admin. Every other account — teacher, coach, or student — is created by an admin already logged in."

---

## 3. Creating a Teacher

Login as admin → **`/admin/teachers/new`**.

The admin fills in name, username, email, password, country, phone, and (optionally) which subjects this teacher covers. Submitting calls the **`create-teacher-with-user`** edge function, which does three things in one shot:

1. Creates the Supabase Auth account (`auth.users`) — this alone fires `create_user_profile()`, which creates the `public.users` row with `role = 'teacher'`.
2. Inserts the `teachers` row, linked via `user_id`.
3. Inserts `teacher_subjects` rows for whatever subjects were picked.

The new teacher gets emailed their login credentials. They log in at `/login` (username → resolved to their Auth email via `get_email_for_username()` → `signInWithPassword()`) and land straight on their own dashboard — no "choose your dashboard" step, since the role decides that automatically.

**Say:** "One edge function, one atomic operation — auth account, profile, and teacher record all created together, so you never end up with a half-created teacher."

---

## 4. Creating a Performance Coach (PC)

Here's a detail worth calling out explicitly, because it surprises people: **a Performance Coach is not a separate account type.** It's the exact same `create-teacher-with-user` flow, with one checkbox ticked: **"Is Performance Coach"**.

- Ticked → `teachers.is_performance_coach = true`, and the trigger `sync_teacher_pc_role()` keeps `users.role` in sync so the sidebar/routing know this person also gets coach-only pages (`/teacher/students`, `/teacher/renewal-requests`). A third coach-only page, `/teacher/subjects-library`, was removed 2026-07-28 — PCs are no longer allowed to add subjects to the shared catalog, which is now admin-only (`/admin/subjects`).
- Unticked → an ordinary teacher, same dashboard minus those coach-only routes.

This reflects a real decision made early on (Key Decision #4): a coordinator/coach in this business is *always* a teacher first — there's no case where someone is a coach but not also qualified to log sessions. So one table (`teachers`), one flag, no separate `coaches` table.

**Say:** "A Performance Coach is just a teacher with a flag turned on — same creation form, same table, just one extra checkbox that unlocks the 'my assigned students' view."

Deactivating either later goes through `deactivate-teacher-with-user`, which refuses to deactivate a PC still holding active student assignments — you have to reassign their students first.

---

## 5. Creating a Student — the longer, more interesting flow

Students aren't created with a simple form — they go through a real **enrollment → payment → review** pipeline, because real money and a real package of hours are involved. Walk through it in order:

**Step 1 — Admin submits an enrollment request.**
`/admin/students/enroll`. Two modes:
- **New student**: full details (name, student's own email — this becomes their login — an optional separate "send updates to" email, curriculum, guardian name/phone, optional report-card upload) **plus a required Performance Coach** — every student must have exactly one active coach from day one.
- **Renewal**: pick an existing student, just enter the new package/hours.

This writes a row to `enrollment_requests` and calls **`send-enrollment-invoice`**, which emails an invoice summary and a one-time `/pay/:token` link to the "send updates to" address.

**Step 2 — Someone pays and uploads proof.**
The `/pay/:token` page is the one *unauthenticated* page in the whole app — no login, the token itself is the access control. They upload a payment screenshot, which hits **`submit-payment-proof`** (the only edge function in this codebase with no JWT check, by design) and lands in the private `payment-proofs` bucket. The request flips to `payment_submitted`.

**Step 3 — Admin reviews and confirms.**
`/admin/enrollments`. The admin opens the request, sees the screenshot, and clicks Confirm (or Reject with a reason, which re-sends the payment link). Confirming calls **`review-enrollment-payment`**, which — for a **new student** — does all of this in one go:
- Creates the `students` row.
- Creates a **single** Auth login (`auth.users` → `public.users`, `role = 'student'`) from the student's own email — this is the student's *only* account; there's no separate parent login (that was merged away 2026-07-07).
- Inserts the `pc_student_assignments` row linking them to the coach picked in Step 1.
- Inserts a `student_packages` row (or one row per pool, if a bundle) and a `package_topups` row.
- Emails the student their own random credentials, and emails the renewal/confirmation to the "send updates to" address.

For a **renewal**, it instead tops up the student's existing unlocked package (or starts a fresh one if the old one was locked) — no new login, no new student row.

**Say:** "A student account isn't just a form submission — it's the end result of a real invoice-and-payment-proof workflow. The login gets created automatically the moment an admin confirms payment, not before."

---

## 6. Everyone log in — what each role actually sees

At this point in the demo, it's worth just switching between three logged-in tabs:

| Role | Lands on | Can do |
|---|---|---|
| **Admin** | `/admin/...` | Everything — full CRUD on teachers, students, sessions, packages (read-only balances, hours only change via enrollment), invoices, monthly reports, homework oversight via the same shared views |
| **Teacher / PC** | `/teacher/...` | Log their own sessions, manage their own subjects, view their own invoices/hours, generate homework papers. A PC additionally sees `/teacher/students` (only their assigned students) and the shared subjects library |
| **Student** | `/student/...` | Fully read-only — their package balance, their reports/invoices, their session history, and (since 2026-07-08) their homework: attempt papers, see published grades |

Every page is gated two ways: `ProtectedRoute` client-side (UX convenience — redirects a mismatched role) **and** Postgres RLS server-side (the actual security boundary — a student physically cannot query another student's row, full stop, even if they bypass the UI).

**Say:** "The frontend routing is just for convenience. If you deleted the entire React app and hit the database directly with a student's token, RLS alone would still stop them from seeing anyone else's data."

---

## 7. The core data flow: logging a session and watching hours move

This is the heart of the system — walk through one real session end to end.

1. **Teacher logs a session** at `/teacher/sessions/new`: picks the student (their own, if a plain teacher; any assigned student, if a coach), the program type / subject, duration, and pastes in Fathom-derived notes (`fathom_summary`, `engagement_rating`, `performance_feedback`, `flag_for_coach`). This writes one row to `session_logs`.
2. **A trigger deducts hours automatically** — `handle_session_log_package_lock()` finds the student's currently-unlocked package for that course type and deducts the logged duration. If the student has *several* concurrent pools of the same course type (a Foundation Program / All-In-One bundle student), the trigger tries to resolve which pool: sticky teacher+subject cache first, then an exact subject-name-to-pool-label match, then — if it genuinely can't tell — it leaves the session as `pool_ambiguous` and fires **`notify-pool-issue`**, emailing the assigned PC to pick manually from a "Pending Deduction" queue.
3. **Threshold notifications** — after the save, **`notify-package-threshold`** fires (fire-and-forget) and emails the PC the first time that package crosses 50%/75%/100% used (or on *every* session once a package is over its limit).
4. **No-show variants** behave differently on purpose: No Show 1 touches nothing; No Show 2 pays the teacher a fixed rate but doesn't touch the student's hours; No Show + does both — pays the teacher *and* deducts hours, using an admin-set default duration rather than asking in the form.
5. **Reporting** — at month end, an admin generates a `monthly_reports` row from `/admin/reports`. Locking it freezes that month's `session_logs` from further edits and snapshots stats (including payable no-shows) into the `monthly_report_*_stats` tables. Separately, `invoices` + `invoice_line_items` get generated per student, sectioned by course-type pool → program/subject → teacher, downloadable as PDF from both the admin side and the student's own `/student/reports`.

**Say:** "A teacher just logs a session like a diary entry. Everything downstream of that — hours deducted, PC notified at 50/75/100%, invoices and monthly reports built — happens off triggers and edge functions, not manual bookkeeping."

---

## 8. The newest layer: Homework Generator (built 2026-07-08, still shipping fixes)

This is the most recently built feature end-to-end, so it's worth demoing last as "here's where the system is headed":

1. Teacher goes to `/teacher/homework`, picks a student, picks a content source — either that student's own session-log Fathom summary, or an uploaded PDF (auto-indexed into chapters/sections by **`index-content-upload`** so generation can be scoped to just a few chapters) — and builds a paper composition (e.g. "4× IBDP Section A + 5× MCQ").
2. **`generate-homework-paper`** calls the Gemini API per block, writes structured questions into `generated_papers.questions_json`, dedupes against a running `question_bank`.
3. Teacher reviews at `/teacher/homework/:paperId` — edit any question, regenerate a single question/block/the whole paper, then **Confirm & Publish**. This emails the student (`notify-homework-published`).
4. Student attempts it at `/student/homework/:paperId` — MCQ/fill-blank/subjective inputs, saves progress, submits. Submitting emails the teacher (`notify-homework-submitted`) and immediately kicks off **`grade-homework-submission`** — objective questions auto-grade, subjective ones get graded per mark-scheme point by Gemini.
5. Grades stay **invisible to the student** (enforced by RLS on `grades.published_at`, not just hidden in the UI) until the teacher reviews and clicks "Publish grade to student" — which emails the student (`notify-homework-grade-published`).
6. Either the Answer Sheet or Question Sheet can be exported as PDF/Word at any stage.

**Say:** "This is the one part of the system where an LLM is actually in the write path — everything else is deterministic triggers and forms. Grading still always ends with a human teacher's sign-off before the student sees a mark."

---

## 9. The one-paragraph architecture summary

React + TypeScript frontend (Vite, Tailwind, React Router — every page has its own URL) talks directly to Supabase (Postgres 17) using the JS client for anything RLS can safely gate, and to Supabase Edge Functions (Deno) for anything that needs the service-role key or an external API call — auth account creation, emails (SMTP via Deno), and Gemini calls. Every table has RLS enabled; the app never trusts client-side role checks as a real boundary. Hosting: Vercel (frontend) + Supabase (managed backend). One migration system (`supabase/migrations/`), one schema doc (`db/docs/VERIFIED_DATABASE_STATE.md`) kept in sync with the live database on every change.

---

## 10. Quick reference — every "how is X created" answer in one table

| Entity | Created by | Mechanism |
|---|---|---|
| First Admin | Manual, once | `db/scripts/create-admin.mjs` or Dashboard + `promote-user-to-admin.sql` |
| Additional Admins | Admin, in-app | `/admin/admins` → "Add admin" form → `create-admin-with-user` edge function (added 2026-07-17) |
| Teacher | Admin, in-app | `/admin/teachers/new` → `create-teacher-with-user` edge function |
| Performance Coach | Admin, in-app | Same as Teacher, with `is_performance_coach` ticked |
| Student (new) | Admin + payer, in-app | `/admin/students/enroll` → `send-enrollment-invoice` → payer uploads proof via public `/pay/:token` → admin confirms via `review-enrollment-payment` |
| Student (renewal) | Admin + payer, in-app | Same pipeline, tops up existing package instead of creating a new login |
| `session_logs` row | Teacher/PC/Admin | Session-log form (shared component across all three roles' pages) |
| `student_packages` row | System, automatic | Created by `review-enrollment-payment` on first purchase of a course type/pool |
| `invoices` row | Admin, in-app | Generated from `/admin/reports` against a month's session logs |
| `generated_papers` row | Teacher, in-app | `/teacher/homework` → `generate-homework-paper` edge function (Gemini) |

---

*For anything this script glosses over — exact columns, RLS policy text, edge function payloads — the authoritative source is `db/docs/VERIFIED_DATABASE_STATE.md` and `db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md`, not this file. This file is a narration aid, not a schema reference, and doesn't need to be regenerated from introspection — just keep it pointed at the right files/routes when they move.*

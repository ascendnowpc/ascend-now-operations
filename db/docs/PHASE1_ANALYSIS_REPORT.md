# Ascend Now — Phase 1 Analysis Report

**Prepared:** 2026-07-21
**Scope:** Full audit of the current dashboard against the four Phase 1 completion criteria, plus a red-flag review of logic and code that could go wrong in production.
**Sources:** `src/` (React app), `supabase/` (86 migrations, 19 edge functions), `db/docs/VERIFIED_DATABASE_STATE.md`, `db/docs/HOURS_AND_REVENUE_LOGIC.md`, `README.md`.

---

## 0. Executive summary

The build is **far past a Phase 1 MVP in feature breadth** — 46 tables, a full admin/teacher/PC/student portal set, an entire homework-generation subsystem, coordinator logs, enrollment/invoice workflow, etc. But measured strictly against the **four Phase 1 acceptance criteria**, only one and a half are cleanly met. The gaps are not in "features to build" — they are in **verification, financial accuracy, and operational safety**, which is exactly the boring stuff a sign-off depends on.

| # | Phase 1 criterion | Status | One-line verdict |
|---|---|---|---|
| 1 | Session data flows form → LAH with zero copy-paste | ✅ **Met** | Form → `session_logs` → DB trigger auto-links to package → LAH is a computed read. No manual re-entry anywhere. |
| 2 | Field validation in place; error rate on test dataset demonstrably reduced | ⚠️ **Partial / unprovable** | Validation exists, but there is **no test suite and no test dataset**, so "demonstrably reduced" cannot be shown. |
| 3 | HR/Finance can generate accurate **payment** summaries | ⚠️ **Partial** | Hours and no-show payouts are exportable, but **there is no pay-rate / price / currency field anywhere** — so no actual money figure can be produced for taught hours. |
| 4 | Backup and restore procedures documented and tested | ❌ **Not met** | **No backup/restore document exists.** Only destructive `wipe-*.sql` scripts are in the repo. |

**Bottom line for sign-off:** Criterion 1 is genuinely done. Criteria 2, 3, and 4 each have a concrete, closeable gap. None require a large rebuild; all require a deliberate, verifiable piece of work that currently isn't there.

---

## 1. Criterion-by-criterion analysis

### ✅ Criterion 1 — Zero manual copy-paste (MET)

**How the flow actually works (verified in code):**

1. Teacher fills `SessionLogFormView.tsx` → one `INSERT` into `session_logs`. Teacher identity is auto-filled from the session (`currentTeacher.id`), never typed.
2. A `BEFORE INSERT/UPDATE/DELETE` trigger — `handle_session_log_package_lock()` — automatically resolves and stamps `session_logs.student_package_id` to the student's currently-unlocked package for that course type. No human links the session to a package.
3. "Learner's Actual Hours" (LAH) is **not a separate data entry surface** — it is a *read-only computed view*. `computeHoursUsed()` in `useStudentPackages.ts` sums `session_duration_hrs` across the student's sessions at render time.

There is no intermediate spreadsheet, no re-keying, no "copy the hours into the package" step. **This criterion is met and is architecturally sound.** ✔️

> ⚠️ One design red flag lives *inside* this otherwise-passing flow — see §2.1 (hours-used is recomputed on the client, never stored). It does not break criterion 1, but it is the single most important thing to understand about how this system counts.

---

### ⚠️ Criterion 2 — Validation present, error-reduction unprovable (PARTIAL)

**What exists (good):**
- Session form (`handleSubmit`, lines ~577-603): student required for real sessions, student-or-name required for demo lessons, Fathom link must match `^https:\/\/fathom\.video\/share\/[a-zA-Z0-9_-]+$`, flag-for-coach requires a comment, locked-month guard.
- DB-level `CHECK` constraints: `session_duration_hrs >= 0` and rounds to 0.25 (15-min) increments; `goal_timeline` day-must-be-1; single-row settings tables enforced by `CHECK (id = 1)`.
- Structured FKs replaced free-text (student_id, subject_id) — a large class of typo errors is designed out.

**The gap (blocking a clean sign-off):**
- **There is no automated test suite.** `package.json` has `dev/build/lint/preview` only — no `test` script, no test runner, and `find` returns **zero** `*.test.ts(x)` / `*.spec.ts` files.
- **There is no "test dataset"** referenced anywhere in the repo.
- Therefore the phrase *"the error rate on the test dataset is demonstrably reduced"* **cannot currently be demonstrated** — there is nothing to measure against and no baseline captured.

**What "done" looks like here:** a fixed sample dataset (the "test dataset" the criterion names), a documented before/after error count, and ideally a handful of unit tests around the money-sensitive pure functions (`computeHoursUsed`, `noShow.ts` predicates, `teacherPeriodDetail`, invoice section aggregation). Validation being present is necessary but not sufficient for this criterion as written.

---

### ⚠️ Criterion 3 — Payment summaries (PARTIAL — a real accuracy gap)

**What HR/Finance can get today:**
- Per-teacher **hours** by month (`fetchTeacherPeriodDetail` → Admin → Teacher's Hours, and the teacher's own My Hours).
- Per-teacher **no-show payout**: payable no-show count × a single flat rate (`no_show_settings.payout_amount`, default 30 SGD), snapshotted onto `monthly_report_teacher_stats` when a report is locked.
- Teacher-uploaded Zoom invoices for admin acknowledgement.

**The gap:** grep across the entire schema for `hourly_rate | price | rate_per | salary | pay_rate | currency | amount_sgd` returns **nothing**. Confirmed also by `HOURS_AND_REVENUE_LOGIC.md`:

> *"there is no dollar-rate or price-per-hour computation anywhere in this codebase … 'Revenue' here means … billable hours."*

**Consequences:**
- The **only** actual currency figure the system can produce is the flat no-show payout. **Taught hours cannot be turned into a payment amount** because no per-hour teaching rate exists (per teacher, per subject, or global).
- The admin "Monthly Revenue" tab and `buildMonthlyRevenuePdf` are named "revenue" but output **hours, not money** — a naming trap that will mislead a Finance user who takes the label at face value.
- The enrollment invoice emailed to families lists packages/hours only — **no price** (README §5 confirms this is known).

**Verdict:** HR/Finance can generate an accurate **hours** summary and a no-show payout total. They **cannot** generate an accurate **payment** summary for teaching, which is what the criterion asks for. Closing this needs a rate model (even a single global SGD/hour constant in a settings table, mirroring the `no_show_settings` pattern, would satisfy the letter of it).

---

### ❌ Criterion 4 — Backup & restore (NOT MET)

- **No backup/restore documentation exists.** Grep for `backup | restore | pg_dump | point-in-time | disaster recovery | restore procedure` across all `.md` files returns nothing describing a procedure.
- What *does* exist in `db/scripts/` are **destructive** scripts: `wipe-hours-and-revenue-data.sql`, `wipe-invoices-and-reports.sql`, `wipe-students-and-testing-data.sql`, `reset-db.sql` (62 KB). These are the *opposite* of a backup story and are dangerous to have lying around without a documented, tested restore path.
- Supabase provides managed backups / PITR, but the criterion requires this to be **documented and tested** — neither is present in the repo, and there's no evidence a restore has ever been rehearsed.

**What "done" looks like:** a `db/docs/BACKUP_AND_RESTORE.md` covering (a) what Supabase plan/PITR window is active, (b) how to take an on-demand logical dump (`pg_dump`) including storage buckets, (c) a **step-by-step restore runbook**, and (d) a dated record of at least one successful restore test into a scratch project. Until that exists and has been exercised once, this criterion is unmet.

---

## 2. Red flags — logic & code (ranked)

### 2.1 🔴 Hours-used is computed on the client, never stored (structural)

`student_packages` stores `total_hours_purchased` but **not** `hours_used`. Every balance, every "X/Y hrs" figure, every invoice section total is derived by `computeHoursUsed()` summing `session_logs` **in JavaScript, on each page load.**

Why this matters:
- **No server-side source of truth for consumed hours.** Correctness depends on every page fetching the *complete* set of relevant sessions and summing identically. There are already **three** subtly different summing helpers (`computeHoursUsed`, `computeHoursUsedBySubject`, `computeHoursUsedByTeacher`) plus the independent `teacherPeriodDetail` path — divergence risk is real.
- **Pagination / RLS row-capping is a silent-undercount hazard.** If any query that feeds a sum is ever limited, filtered, or partially blocked by RLS, the balance reads *low* with no error — a family could appear to have hours they've spent, or a teacher's payout base could be understated.
- The `student_package_id`-scoping fix (2026-07-02) shows this fragility was already hit once: locked-package hours were "bleeding into" renewals until the sum was re-scoped by package id.

**Recommendation:** treat a stored, trigger-maintained `hours_used` (or a `SUM` in a DB view/materialized view) as the source of truth, and make the client display it rather than recompute it. At minimum, add unit tests pinning the three helpers to identical results on shared fixtures.

### 2.2 🟠 "Monthly Revenue" means hours, not money (naming/finance trap)
As covered in criterion 3. A Finance user will read "revenue" as currency. Either rename it to "Billable Hours" until a rate exists, or add the rate. This is a correctness-of-communication bug even though the numbers are internally consistent.

### 2.3 🟠 Zero-active-pool fallback silently creates 0-hour "overage" pools
When a session is logged for a student with no matching package, `handle_session_log_package_lock()` **auto-creates a fresh zero-hour pool** and stamps `pool_fallback_used = true` rather than blocking. The session saves and reads as e.g. "1/0 hrs used." This is *by design* (it avoids losing data and it was hardened on 2026-07-05 to stop borrowing across course types — a genuine past billing bug on student S1). **But:** reconciliation depends entirely on a human noticing the overage flag / acting on a `notify-pool-issue` email. Nothing forces resolution; an unnoticed overage means a student is consuming hours they never bought, invisibly.

### 2.4 🟠 Multi-pool sessions can sit unresolved (`pool_ambiguous`) indefinitely
For bundle students (Foundation Program / All-In-One), a session whose pool can't be inferred is saved with `student_package_id = NULL, pool_ambiguous = true` and **excluded from every balance** until a PC manually resolves it. If the notifying email doesn't fire (see 2.5) or the PC ignores it, those hours are **uncounted** — the student's balance looks healthier than reality and the teacher's billable picture is incomplete.

### 2.5 🟠 Notification email delivery is unverified (secrets "need to be confirmed set")
`VERIFIED_DATABASE_STATE.md` explicitly notes for `notify-pool-issue` (and the same pattern applies to `notify-package-threshold`): *"its `PUBLIC_APP_URL`/`SMTP_*` secrets still need to be confirmed set before it can actually send."* The reconciliation flows in 2.3/2.4 lean on these emails as the *only* prompt to act. If SMTP isn't configured in prod, the whole "a human will catch it" safety net silently doesn't exist. **Verify these secrets are set in production and that a test email actually delivers.**

### 2.6 🟡 `submit-payment-proof` is a public, unauthenticated edge function
Documented as *"the only edge function in this codebase with no JWT check — public by design."* Access control is the URL token alone. This is a reasonable pattern for a pay link, but it means: no rate-limiting mentioned, token in a URL (logged by proxies/history), and anyone with the token can upload arbitrary files to the private `payment-proofs` bucket. Confirm there's a size/content-type limit and that tokens are single-purpose and expire.

### 2.7 🟡 `SET search_path` missing on most `SECURITY DEFINER` functions
Supabase advisors flag `function_search_path_mutable` on nearly all functions (only `create_user_profile`, `sync_teacher_pc_role`, `rls_auto_enable`, `handle_session_log_package_lock` set it). Not currently exploitable, but these are privilege-elevated functions; a mutable search_path is a known escalation vector. Cheap to harden — add `SET search_path = public` to each.

### 2.8 🟡 Client-side role checks are cosmetic; several scopings are display-only
`ProtectedRoute` and the `allowedIds`/`scopeToTeacherId` props are **UX conveniences, not security** (README §3.6 says so plainly, correctly). The real boundary is RLS. This is fine *as designed*, but note that "My Students" scoping for PCs is deliberately display-only — any staff row can read every student. That's an accepted decision, not a bug, but worth Finance/HR knowing when they reason about who-can-see-what.

### 2.9 🟡 Duplicate/overlapping RLS policies on several tables
`session_logs`, `curricula`, `subjects`, `subject_categories`, `teacher_subjects`, `program_types` carry redundant policies from iterative migrations (README §5). Not broken, but overlapping policies make it easy to *think* you've tightened access when a broader leftover policy still grants it. Consolidate and re-audit.

### 2.10 🟡 No pricing on enrollment invoices (known, README §5)
Families receive an "invoice" with packages/hours but no amount owed. This is internally acknowledged and ties back to criterion 3's missing rate model.

### 2.11 🟢 Single-source-of-truth doc discipline is strong (a genuine positive)
The repo enforces (via `CLAUDE.md`) that `VERIFIED_DATABASE_STATE.md` is regenerated from live introspection, and it caught/undid real bugs (the S1 cross-course-type borrow, the login-lockout email desync). This is above-average operational hygiene and should be preserved.

---

## 3. What is left / what should be there (by theme)

**To close Phase 1 as written:**
1. **Backup & restore runbook + one tested restore** (criterion 4) — highest priority, currently zero coverage.
2. **A pay-rate model** (criterion 3) — even a single global SGD/hour setting unblocks real payment summaries; rename "Monthly Revenue" → "Billable Hours" until then.
3. **A test dataset + before/after error measurement**, and a minimal unit-test harness on money-sensitive pure functions (criterion 2).

**Robustness (should exist, independent of Phase 1 wording):**
4. Make consumed-hours a stored/DB-computed source of truth, or pin the three client helpers with tests (§2.1).
5. Confirm SMTP/`PUBLIC_APP_URL` secrets in prod and prove notification delivery (§2.5); add a report/queue for unresolved `pool_ambiguous` + `pool_fallback_used` sessions so reconciliation isn't email-dependent (§2.3/2.4).
6. Harden `SET search_path` on all SECURITY DEFINER functions; consolidate duplicate RLS policies (§2.7/2.9).
7. Confirm upload limits/expiry on the public `submit-payment-proof` path (§2.6).

**Phase 2 (already partly pre-built, do not expand until Phase 1 is signed off):**
- Student/parent view, Performance Coach dashboard, and the AI insights layer (homework generator, session summaries) are **substantially built already**. Per the Phase 2 clause, this work is *conditional on written Phase 1 sign-off* — so the risk here is inverted: effort has gone ahead of the gate. Freeze Phase 2 surface area and redirect to closing the four criteria above.

---

## 4. The single most important sentence

> The dashboard's **features** are well ahead of Phase 1, but its **provable guarantees** — a tested restore, a real money figure, and a measured error rate — are the three things a sign-off actually rests on, and those are exactly what's missing.

# Testing Results — Ascend Now Dashboard

**Run:** 2026-07-21
**Performed by:** automated audit (static build, unit tests, live DB integration tests against the production Supabase project `uqyuczvckqxgtilpzarh`).
**Companion to:** `PHASE1_ANALYSIS_REPORT.md` / `Ascend_Now_Phase1_Phase2_Analysis_Report.docx`.

> **Environment note.** The dashboard UI could not be driven in a browser from the audit environment: its network policy blocks outbound `CONNECT` to `*.supabase.co` (proxy returns `403`), so the app can't reach its backend from here. Live testing was therefore done at the **database layer** via the Supabase MCP (server-side, policy-exempt), which exercises the real triggers, RLS, and billing math directly — where the actual risk lives — without invoking the email edge functions. Browser E2E needs either that host allow-listed or a run from a network that can reach Supabase.

---

## 1. Build & typecheck — PASS

| Check | Result |
|---|---|
| `tsc -b` (full typecheck) | ✅ 0 errors |
| `vite build` (production bundle) | ✅ built, 1301 modules |
| Bundle size | ⚠️ main chunk **3.35 MB (968 KB gzip)**, no code-splitting — a real load-performance issue (see below) |

## 2. Lint — 98 problems (categorised)

| Rule | Count | Nature |
|---|---|---|
| `react-hooks/set-state-in-effect` | 64 | React 19 advisory (cascading-render perf), not crashes |
| `typescript-eslint/no-unused-expressions` | 11 | mostly `cond && fn()` patterns |
| `react-refresh/only-export-components` | 9 | HMR hygiene |
| `react-hooks/exhaustive-deps` | 9 | dependency-array — a few could mask stale-closure bugs, worth a pass |
| `react-hooks/preserve-manual-memoization` | 4 | React Compiler |
| `no-explicit-any` / `immutability` / `preserve-caught-error` | 4 | minor |

No blocking errors; nothing prevents build or run.

## 3. Unit tests — 40/40 PASS (new)

A Vitest harness was added (`npm test`) with 40 tests over the money- and logic-sensitive pure functions. The three billing aggregators were first extracted from `useStudentPackages` into a pure, testable `src/utils/packageHours.ts` (behaviour-preserving; the hook re-exports them). Coverage:

- **`packageHours` (billing engine)** — course-type matching, No Show 1/2 exclusion vs No Show + inclusion, `studentPackageId` scoping (the locked-package-bleed prevention), legacy `null`-package fallback, null-duration safety, per-subject / per-teacher aggregation and no-show split.
- **`noShow`** — the payout/deduction predicates and label pluralisation.
- **`formatHours`** — quarter-hour precision, float-artifact stripping (`0.1+0.2`), whole-number trimming.
- **`localDate`** — timezone-safe "today" (no `toISOString` day-roll).
- **`subjectBranch`** — category → branch and course-type → branch mapping.
- **`homeworkGrading`** — option-label stripping, teacher-override math, pending-manual detection, and the RLS-aware `homeworkStage` (graded only once published).

## 4. Live database integrity — mostly PASS

Run against production `session_logs` (65 rows), `student_packages` (13):

| Check | Result |
|---|---|
| No Show 1/2 carry no billing fields; No Show + carries them | ✅ 0 violations |
| Session duration on the 0.25 grid | ✅ 0 violations |
| Ambiguous sessions left unresolved (silently un-billed) | ✅ 0 currently |
| Billable session with no package link (unresolved deduction) | ✅ 0 |
| Orphan `student_id` FK | ✅ 0 |
| **Fallback "overage" pools** (report finding 6.3) | ⚠️ **1** — S1 Academic pool, the documented case |
| **Per-package hours reconciliation** (used vs purchased) | ⚠️ **1 of 13 over limit** — S1 Academic pkg 11: **17.00 used / 16.00 purchased**; all others within bounds |

The reconciliation matched the client's `computeHoursUsed` scoping exactly — **no hidden drift** between the JS-computed balances and server-side truth, which is the good news against report finding 6.1 (the risk is structural, not currently realised).

## 5. Live trigger / workflow tests

| Test | Result |
|---|---|
| **Criterion 1** — insert an Academic session for S1 with no package chosen → deduction trigger auto-links it | ✅ **PASS** — trigger set `student_package_id = 11` automatically, `pool_ambiguous = false`. (Test row inserted and then deleted; table verified back to 65 rows.) |
| **Locked-month guard** — insert a session dated in the locked month (Jul 2026) | ✅ **PASS** — correctly rejected: *"Cannot insert this session log into Jul 2026 — that report month is locked."* |
| Post-lock inserts | ✅ blocked (`created_after_lock = 0` across all July sessions) |

## 6. 🔴 HIGH — Locked monthly report is stale (Criterion 3 defect)

**The locked payment report does not match the session data for its own month.** Reconciling the locked Jul-2026 report (`monthly_reports.id = 3`) teacher snapshot against raw `session_logs` for 2026-07-01…07-31:

| Teacher | Snapshot hours | Actual hours | Missing |
|---|---|---|---|
| 133 (test PC) | 36.00 | 36.50 | 0.50 |
| 141 (aayush gupta) | 0.00 | 1.25 | 1.25 |
| 37 (Aditya Singh) | *(absent)* | 1.00 | 1.00 (whole teacher) |
| 142 (aayush gupta) | *(absent)* | 11.25 | 11.25 (whole teacher) |

The report claims **36 total hours**; the actual July sessions sum to **~50 billable hours**.

**Root cause (confirmed by timestamps):** the report was **generated 2026-07-06 06:49** and **locked 2026-07-10 11:31**. Every missing session was `created_at` *after* generation but *before* lock (teacher 142's 10 sessions were all created 07-08…07-10). **Locking freezes the snapshot taken at generation time and never regenerates it**, so any session logged in the window between "generate report" and "lock report" is silently omitted from the payment figures HR/Finance pays from.

> Some of these specific rows belong to test accounts ("test PC", students S1/S9/S12), so the dollar impact here is not real — but the **logic defect is real and environment-independent**: it would drop genuine teacher hours in production exactly the same way.

**Recommended fix (needs a product decision):** either (a) **regenerate the snapshot at lock time** so locking always freezes current data, or (b) **refuse to lock** while the snapshot is stale relative to sessions in the period (force a regenerate-then-lock). Option (a) is simpler and matches user intent ("lock = freeze what's true now"). The already-locked report 3 also holds stale data and would need an unlock → regenerate → relock to correct.

## 7. Live security advisors (Supabase) — 62 findings

| Advisor | Count | Note |
|---|---|---|
| `security_definer_function_executable` (anon + authenticated) | 40 | SECURITY DEFINER functions executable by `anon`/`authenticated` roles — review which need it |
| `function_search_path_mutable` | 17 | confirms report finding 6.8 — add `SET search_path` |
| `public_bucket_allows_listing` | 4 | **new** — 4 public storage buckets allow anyone to enumerate their contents; confirm no sensitive file paths are exposed |
| `auth_leaked_password_protection` | 1 | **new** — leaked-password protection is disabled in Supabase Auth; cheap to enable |

---

## Summary

- **What works:** the core session→package auto-linking (Criterion 1), no-show billing rules, the quarter-hour/lock guards, and per-package balance math all pass on live data. Build is clean; a real unit-test harness now exists (40 passing).
- **What to fix, in priority order:**
  1. 🔴 **Stale locked monthly report** (§6) — a Criterion-3 payment-accuracy defect. Regenerate-on-lock.
  2. 🟠 **No pay-rate model** (report §3.3 / Criterion 3) — even with §6 fixed, the report still yields *hours*, not money.
  3. 🟠 **Overage pool reconciliation** (§4, report 6.3) — 1 live overage; needs a dashboard queue, not email-only.
  4. 🟡 Security advisors (§7): `search_path`, public-bucket listing, leaked-password protection.
  5. 🟡 Bundle code-splitting (§1) and the `exhaustive-deps` lint pass (§2).
- **Not yet tested (needs UI reachability or credentials):** end-to-end browser flows — login redirect by role, form submission UX, PDF/DOCX export rendering, email delivery (SMTP secrets, report finding 6.5). These require the Supabase host allow-listed or a run from a reachable network.

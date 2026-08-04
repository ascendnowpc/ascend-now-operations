# Code Architecture — Ascend Now Operations

**A file-level map of the codebase: what each layer is responsible for, which file talks to which, and how data actually moves from a click to a database row and back.**

This document is about **code structure**, not features. For what the system does, see [`README.md`](../README.md). For the exact database schema, see [`db/docs/VERIFIED_DATABASE_STATE.md`](../db/docs/VERIFIED_DATABASE_STATE.md). For a narrated walkthrough of the business flows, see [`SYSTEM_WORKFLOW.md`](../SYSTEM_WORKFLOW.md).

---

## Table of contents

1. [The system in one diagram](#1-the-system-in-one-diagram)
2. [Repository map](#2-repository-map)
3. [The layering rule](#3-the-layering-rule)
4. [Bootstrap chain](#4-bootstrap-chain)
5. [Routing and role gating](#5-routing-and-role-gating)
6. [Identity: `AuthContext`](#6-identity-authcontext)
7. [Layouts and navigation](#7-layouts-and-navigation)
8. [The page → view → hook pattern](#8-the-page--view--hook-pattern)
9. [The hook layer](#9-the-hook-layer)
10. [The cache layer](#10-the-cache-layer)
11. [Backend path A — direct to Postgres](#11-backend-path-a--direct-to-postgres)
12. [Backend path B — edge functions](#12-backend-path-b--edge-functions)
13. [File storage](#13-file-storage)
14. [The Gemini integration](#14-the-gemini-integration)
15. [Logic that lives in the database](#15-logic-that-lives-in-the-database)
16. [Pure logic and the test suite](#16-pure-logic-and-the-test-suite)
17. [The type contract](#17-the-type-contract)
18. [End-to-end data flow traces](#18-end-to-end-data-flow-traces)
19. [Cross-cutting conventions](#19-cross-cutting-conventions)
20. [Build, deploy and configuration](#20-build-deploy-and-configuration)
21. [Adding a feature — the checklist](#21-adding-a-feature--the-checklist)
22. [Historical scars worth knowing](#22-historical-scars-worth-knowing)

---

## 1. The system in one diagram

There is no separate backend codebase. One React app, a folder of server-side functions, a folder of SQL.

```
                    BROWSER
  ┌──────────────────────────────────────────────┐
  │ main.tsx → App.tsx                           │
  │   └ AuthProvider (session + role)            │
  │       └ ProtectedRoute (role gate)           │
  │           └ pages/<role>/XPage.tsx  (thin)   │
  │               └ <Role>Layout  (sidebar)      │
  │                   └ components/…/XView.tsx   │
  │                       ├ utils/*.ts  (pure)   │
  │                       └ hooks/useX.ts        │
  │                           └ lib/supabaseClient│
  └───────────────┬──────────────────┬───────────┘
                  │                  │
       PATH A     │                  │   PATH B
   (most traffic) │                  │  (privileged)
                  ▼                  ▼
        ┌──────────────────┐  ┌────────────────────────┐
        │ PostgREST        │  │ supabase/functions/*    │
        │ (auto REST over  │  │ Deno, service-role key, │
        │  the tables)     │  │ SMTP + Gemini secrets   │
        └────────┬─────────┘  └───────────┬────────────┘
                 │                        │
                 ▼                        ▼
        ┌────────────────────────────────────────────┐
        │            PostgreSQL 17                    │
        │  RLS policies · triggers · CHECK constraints│
        └────────────────────────────────────────────┘
```

| Count | Where |
|---|---|
| 69 page files | `src/pages/` |
| 62 component files | `src/components/` |
| 40 hooks | `src/hooks/` |
| 35 utility modules (+27 test files) | `src/utils/` |
| 4 infrastructure modules | `src/lib/` |
| 21 edge functions | `supabase/functions/` |
| 114 migrations | `supabase/migrations/` |
| 46 tables | live database |

---

## 2. Repository map

### `src/lib/` — infrastructure (4 files)

Everything else imports from here. Small, and deliberately so.

| File | Responsibility |
|---|---|
| `supabaseClient.ts` | Creates the single shared Supabase client from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Warns loudly at startup if either is missing. Carries the comment explaining why the service-role key must **never** appear in a frontend env var. |
| `edgeFunctions.ts` | `invokeEdgeFunction()` — a drop-in replacement for `supabase.functions.invoke` that unwraps real error messages and recovers dead sessions. Plus `describeFunctionError()`. |
| `cache.ts` | A 60-second in-memory `Map` with prefix invalidation. ~20 lines. |
| `assignmentNotifier.ts` | Fire-and-forget wrapper around the `notify-assignment-change` function. |

### `src/context/` — app-wide state (1 file)

`AuthContext.tsx` is the only React context in the app. Session, profile, role, and the four self-service account mutations.

### `src/types/` — the shared contract (1 file)

`database.ts`, 1,145 lines. One interface per table plus every enumerated union (`UserRole`, `NoShowType`, `StudentStatus`, `CcAssignmentStatus`, `EnrollmentStatus`, …). Imported by hooks, components, pages and utils alike.

### `src/data/` — static reference data

`countries.ts` and `countryCodes.ts` — the country and dial-code pickers. `countryCodes` has its own test.

### `src/utils/` — pure functions (35 modules, 27 tested)

No React, no network, no Supabase import. This is where business rules live so they can be unit-tested. Also holds the document builders (`buildInvoicePdf.ts`, `exportHomeworkPaper.ts`, `buildSummaryDoc.ts`) which are pure in the same sense — data in, file bytes out.

### `src/hooks/` — the data access layer (40 hooks)

The **only** place in the app that queries the database. One hook per table or concern.

### `src/components/` — the real UI (62 files)

Grouped by feature. `ui/` holds the primitives; every other subfolder holds a feature's shared views.

```
components/
├── ui/              Button, Card, Input, DataTable, Spinner, ConfirmDialog,
│                    StudentSearch, SubjectLevelSelect, BeyondAcademicSubjectSelect,
│                    MultiSelect, RowMenu, StarRating, Toast, icons, ReportSectionsView
├── layout/          DashboardShell (sidebar chrome), PageHeader
├── sessionLogs/     SessionLogFormView · SessionLogsListView · SessionLogDetailView
├── students/        StudentDetailView · StudentsListView · StudentStatusControls
├── coordinatorLogs/ CoordinatorLogFormView · ListView · DetailView · SubjectPicker ·
│                    Sections · HistoryList
├── homework/        QuestionReviewCard · QuestionAttemptCard · QuestionContent ·
│                    TeacherPaperResults · AnnotatableMedia · SessionLogPicker ·
│                    ContentScopePicker · HomeworkResultsList · HomeworkExportButtons ·
│                    AcademicSubjectPicker
├── portal/          StudentOverviewView · StudentSessionsView · StudentPackagesView ·
│                    StudentReportsView · StudentInfoFields ·
│                    StudentCompleteProfileGate · TeacherCompleteProfileGate
├── pc/              PcProfileCard · PcProfileEditor · PcAssignmentReport · profileIcons
├── subjects/        TeacherSubjectEditor · SubjectsLibraryContent
├── notes/           AddSubjectNoteForm · SubjectNotesList
├── analysis/        EntityStatsTable
├── account/         AccountSecurityCards
└── ProtectedRoute.tsx
```

### `src/pages/` — one file per route (69 files)

Split `admin/` · `teacher/` · `student/` plus two top-level pages (`LoginPage.tsx`, `PublicPaymentPage.tsx`). Also holds the three layouts (`AdminLayout.tsx`, `TeacherLayout.tsx`, `StudentLayout.tsx`), which live here rather than in `components/layout/` because they encode role-specific navigation.

### `supabase/functions/` — the privileged backend (21 functions)

Each is a standalone Deno `index.ts` with no shared framework and no `_shared` folder — every function repeats its own CORS headers and client setup. Verbose, but each deploys independently with no coupling.

### `supabase/migrations/` — the schema (114 files)

Append-only, timestamped. `20260701000000_baseline_full_schema.sql` is the consolidated baseline generated from live introspection; everything after it is an incremental change. Never edit a past file.

---

## 3. The layering rule

**Each layer knows only about the layer directly beneath it.** Dependencies point one way:

```
pages  →  components  →  hooks  →  lib  →  network
   ↘          ↘           ↘
    └──────────┴───────────┴──→  utils  (pure, imports nothing upward)
                            └──→  types  (imported by everything)
```

Concretely, the invariants:

- **A component never builds a query.** No `supabase.from(...)` in `components/` except two documented exceptions — `SessionLogFormView.tsx` (inserts a `subject_notes` row as a best-effort side effect of saving a session, and uploads a summary doc to storage) and `CoordinatorLogFormView.tsx`.
- **A hook never renders.** Hooks return data and functions, never JSX.
- **A utility never touches the network or React.** That's what makes them testable in a plain Node environment.
- **A page holds almost no logic.** It picks a layout and a view and passes a `role`.

This constraint is what lets the same screen serve four roles without conditional logic scattered across the tree.

---

## 4. Bootstrap chain

```
index.html
  └─ src/main.tsx                 createRoot(...).render(<StrictMode><App/></StrictMode>)
      └─ src/App.tsx              <BrowserRouter><AuthProvider><Routes>…
          └─ AuthContext          resolves session, loads public.users row → profile.role
              └─ ProtectedRoute   gate per route
                  └─ XPage        picks layout + view
                      └─ XLayout  sidebar chrome + first-login gates
                          └─ XView   the actual screen
```

`main.tsx` does four lines of real work. `App.tsx` is 73 route definitions and nothing else — no logic, no state.

---

## 5. Routing and role gating

`src/App.tsx` declares every route. Each protected one is wrapped:

```tsx
<Route path="/admin/students/:id" element={
  <ProtectedRoute allowedRoles={["admin"]}>
    <AdminStudentDetailPage />
  </ProtectedRoute>
} />
```

Distribution of the 66 gated routes:

| `allowedRoles` | Routes |
|---|---|
| `["admin"]` | 36 |
| `["teacher", "performance_coach", "college_counselor"]` | 11 |
| `["student"]` | 9 |
| `["performance_coach", "college_counselor"]` | 8 |
| `["teacher"]` | 2 |

The remaining routes are public: `/login`, `/pay/:token`, and the redirects.

### `components/ProtectedRoute.tsx`

Reads `useAuth()` and does four things in order:

1. `loading` → spinner (prevents a flash of the wrong dashboard)
2. no session or no profile → `<Navigate to="/login">`
3. `profile.is_active === false` → a full-screen "Account Deactivated" card with a sign-out button
4. role not in `allowedRoles` → redirect to *that role's own* dashboard, not to login

The file carries an explicit block comment stating it is a **convenience layer only** and that RLS is the real boundary. That comment is load-bearing — it's there so nobody later mistakes route gating for security.

---

## 6. Identity: `AuthContext`

`src/context/AuthContext.tsx` is the root of all identity data.

### What it exposes

```ts
{ session, profile, loading,
  signInWithUsername, signOut,
  updateUsername, updateFullName, updateEmail, updatePassword }
```

`profile` is the `public.users` row — critically, it carries `role`, which drives every redirect, every sidebar shape, and every route gate.

### The login flow (three network calls)

```
signInWithUsername(username, password)
  1. supabase.rpc("get_email_for_username", { p_username })   → the Auth login email
  2. supabase.auth.signInWithPassword({ email, password })     → Supabase Auth verifies
  3. select is_active from users where id = …                  → deactivated? sign back out
```

Why the indirection: people log in with a **username**, but Supabase Auth authenticates on **email**. The resolver is a database function, and it reads `auth.users.email` rather than the mutable `public.users.email` — so an in-app email change can never desync the resolver from what Auth actually checks. That desync once locked a coach out of their account.

### The tab-focus guard

Supabase fires `onAuthStateChange` with `SIGNED_IN` / `TOKEN_REFRESHED` **every time a tab regains focus**. Reacting to those naively called `setSession` + `loadProfile` for the same user, re-rendering the whole tree and making long forms (the coordinator log especially) scroll back to the top. The provider now holds `currentUserIdRef` and returns early when the user id hasn't changed:

```ts
const newUserId = newSession?.user?.id ?? null;
if (newUserId === currentUserIdRef.current) return;
```

### Email changes route through an edge function

`updateEmail()` calls `invokeEdgeFunction("update-user-email")` rather than writing the table, because three places must move together: `auth.users.email` (the login credential), `public.users.email` (the display identity) and `teachers.email` (contact info). A direct table write would update one and leave the login broken.

---

## 7. Layouts and navigation

Three layouts live in `src/pages/<role>/`:

| Layout | Builds |
|---|---|
| `AdminLayout.tsx` | Six collapsible sidebar groups — Roles, Students, Teachers, Performance Coaches, College Counsellors, Configuration — plus standalone Overview and Renewal Requests |
| `TeacherLayout.tsx` | Flat list for a plain teacher; grouped sections for a coach or counsellor |
| `StudentLayout.tsx` | Flat list; the My CC tab appears only when the student has a live counsellor |

All three render `components/layout/DashboardShell.tsx`, which owns the actual chrome: responsive sidebar, mobile drawer, `NavItem` rendering including expandable `children` groups that auto-open when you're on one of their routes.

### Role resolution in `TeacherLayout`

The teacher panel is where role logic concentrates, and it delegates all of it to a tested utility:

```ts
const { isCoach, isCounsellor } = staffRoleFlags(profile?.role, teacher);
const roleLabel = staffRoleLabel({ isCoach, isCounsellor });
const nav = hasCoordinatorPanel({ isCoach, isCounsellor }) ? coordinatorNav : plainTeacherNav;
```

All three helpers live in `src/utils/staffRole.ts` with tests. The subtlety they encode: a person may carry **both** the coach and counsellor flags on their `teachers` row even though `users.role` holds only one login role. A coach and a counsellor get the *identical* panel — only the section heading changes — so nothing else in the app branches on which of the two someone is.

### First-login gates

Two layouts intercept rendering entirely when a profile is incomplete:

```ts
if (!loading && teacher && teacherNeedsProfileCompletion(teacher)) {
  return <TeacherCompleteProfileGate … />;   // full screen, blocks every route
}
```

`teacherNeedsProfileCompletion()` and `studentNeedsProfileCompletion()` both live in `src/utils/profileCompletion.ts` (19 tests). The gate exists because the admin add-teacher form only requires a first name — everything else is collected from the person themselves on first login.

---

## 8. The page → view → hook pattern

**This is the single most important convention in the codebase.**

A page file is a thin wrapper. The screen lives in a shared view component consumed by two or three pages, differentiated by a `role` prop.

```tsx
// src/pages/teacher/TeacherSessionFormPage.tsx   (26 lines)
<TeacherLayout>
  <SessionLogFormView
    role="teacher"
    currentTeacher={teacher}          // identity fixed — no Teacher dropdown
    currentTeacherLoading={teacherLoading}
    allSubjects={allSubjects}         // useSubjects — active only
  />
</TeacherLayout>

// src/pages/admin/AdminSessionLogFormPage.tsx    (18 lines)
<AdminLayout>
  <SessionLogFormView
    role="admin"
    allSubjects={allSubjects}         // useAllSubjects — includes inactive
  />
</AdminLayout>
```

All 1,369 lines of form behaviour live once in `components/sessionLogs/SessionLogFormView.tsx`. Role differences are branches on `role` **inside** that file:

| Behaviour | `role="admin"` | `role="teacher"` |
|---|---|---|
| Teacher field | free-choice dropdown | fixed to the logged-in teacher |
| Subject list | every subject incl. inactive | active only |
| Student search | unrestricted | scoped to the coach's/counsellor's roster |
| Editing an existing log | always allowed (unless month locked) | coach/counsellor only |
| Raw session ID shown | yes | no |
| Card width | full | `max-w-2xl` |

### Registry of shared views

| Shared view | Lines | Consumed by |
|---|---|---|
| `students/StudentDetailView.tsx` | 1,844 | `/admin/students/:id`, `/teacher/students/:id` — all five tabs |
| `sessionLogs/SessionLogFormView.tsx` | 1,369 | admin + teacher session forms |
| `subjects/SubjectsLibraryContent.tsx` | 1,110 | admin subject catalogue |
| `sessionLogs/SessionLogsListView.tsx` | 669 | `/admin/session-logs`, `/teacher/sessions`, `/teacher/student-logs` |
| `coordinatorLogs/CoordinatorLogFormView.tsx` | 537 | admin + coach/counsellor coaching log |
| `subjects/TeacherSubjectEditor.tsx` | 475 | `/admin/teacher-subjects` (`variant="admin"`), `/teacher/subjects` (`variant="teacher"`) |
| `students/StudentsListView.tsx` | 435 | admin students, coach roster, counsellor roster, per-coach tab on `/admin/pcs/:id` |
| `pc/PcProfileCard.tsx` | 368 | admin editor preview, coach's own page, student's My PC **and** My CC |
| `homework/TeacherPaperResults.tsx` | 481 | teacher review page, read-only for PC and admin |
| `homework/HomeworkResultsList.tsx` | 205 | student-detail Homework tab, `/teacher/homework` results tab |

`StudentDetailView.tsx` is the largest file in the app because it holds five tabs (Details, Learner's actual hours, Homework, Coordinator Log, Reports) for two different roles. Its import list is a good illustration of how a top-level view composes: 8 hooks, 7 utils, 6 UI primitives, 3 feature components, 1 context.

### The two exceptions

Not every view is shared, and the deviations are deliberate:

- `portal/StudentSessionsView.tsx` is **modelled on** but not a reuse of `SessionLogsListView` — the student version drops so many columns (engagement, independent work, feedback, flags, Fathom transcript) that sharing would have meant more branches than code.
- `pages/PublicPaymentPage.tsx` bypasses the entire stack. No layout, no hook, no auth client — it `fetch`es the edge function URL directly, because the page has no logged-in user.

---

## 9. The hook layer

40 hooks in `src/hooks/`, roughly one per table or concern. **No component builds a query.**

### Standard anatomy

Every hook follows the same shape:

```ts
export function useX(filters = {}, ...scopeArgs) {
  const [rows, setRows]       = useState<X[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const key = cacheKey(filters, ...scopeArgs);
    const cached = getCached<X[]>(key);
    if (cached) { setRows(cached); setLoading(false); return; }

    let query = supabase.from("x").select("*").order(…);
    if (filters.a) query = query.eq("a", filters.a);      // built incrementally
    …
    const { data, error } = await query;
    if (error) setError(error.message);
    else { setCached(key, data); setRows(data); }
    setLoading(false);
  }, [/* every filter, flattened */]);

  useEffect(() => { refetch(); }, [refetch]);

  async function createX(input) { … invalidateCachePrefix("x:"); … }
  async function updateX(id, input) { … }
  async function deleteX(id) { … }

  return { rows, loading, error, refetch, createX, updateX, deleteX };
}
```

Conventions worth noting:

- **Errors are returned, never thrown.** Every mutator returns `{ data, error: string | null }`. Components render the message; nothing bubbles to an error boundary.
- **Dependency arrays are flattened.** `[filters.year, filters.month, …]`, never `[filters]` — an object literal would be a new reference every render and refetch forever.
- **Array scope args are joined to a string** (`scopeToStudentIds?.join(",")`) for the same reason.
- **Mutators update local state optimistically** *and* invalidate the cache, so a new row appears without a round trip but any other screen refetches.
- **Standalone fetchers sit beside the hook** for one-off reads outside React's lifecycle: `fetchSessionLogById`, `fetchTeacherById`, `fetchLatestCoordinatorLogForStudent`, `fetchSubjectGradeHistoryForStudent`.

### Scoping is a hook argument, not a component concern

`useSessionLogs` takes four arguments and that is how one hook serves every role:

```ts
useSessionLogs(filters)                                   // admin — everything
useSessionLogs(filters, teacher.id)                       // a teacher's own logs
useSessionLogs(filters, undefined, student.id)            // a student's own logs
useSessionLogs(filters, undefined, undefined, rosterIds)  // a coach's whole roster
```

The scope becomes a real SQL clause (`.eq`, `.in`), so filtering happens **server-side** — a filtered page transfers only matching rows. Same for `useAnalysisDashboard`, whose entire filter set is applied in the query rather than in the browser.

### Hook inventory

| Domain | Hooks |
|---|---|
| Identity | `useUsers`, `useAdmins`, `useMyTeacherProfile`, `useMyStudent`, `useTeachers` (+ `useInactiveTeachers`, `useTeacherSubjects`, `useAllTeacherSubjects`), `useTeacherNames` |
| Students | `useStudents`, `usePcAssignments`, `useCcAssignments`, `usePcProfile`, `useAssignedPcProfile`, `useAssignedCcProfile` (+ `useHasAssignedCc`), `usePcReport` |
| Sessions | `useSessionLogs`, `useCoordinatorLogs` (+ `useStudentCoordinatorLogs`, `useCoordinatorLogMutations`), `useCoordinatorLogOptions`, `useSubjectNotes` |
| Catalogue | `useSubjects` (+ `useAllSubjects`, `useSubjectsByGroup`), `useCurricula` (+ `useAllCurricula`), `useCurriculumGroups` (+ `useAllCurriculumGroups`), `useSubjectCategories`, `useProgramTypes`, `useCourseTypes` |
| Money | `useStudentPackages`, `useInvoices`, `useMonthlyReports`, `useEnrollmentRequests`, `useRenewalRequests`, `useZoomInvoices`, `useBundlePoolSettings` |
| Homework | `useGeneratedPapers`, `useGeneratedPaper`, `useStudentHomework`, `useStudentAttempt`, `useSubmissionGrade`, `useContentUpload` (+ `useTeacherUploads`), `useStyleTemplates` |
| Settings | `useNoShowSettings`, `useSessionDurationSettings` |
| Analytics | `useAnalysisDashboard` |

### The heaviest hook: `useStudentPackages`

409 lines, and the only hook exposing nineteen functions, because the package/pool model is the most intricate part of the domain:

```
fetchPackagesForStudent · getOrCreatePackage · createLabeledPackage · addTopup
lockPackage · unlockPackage
computeHoursUsed · computeHoursUsedBySubject · computeHoursUsedByTeacher
fetchSessionsForBalance · fetchPendingPoolSessions · fetchActivePoolsForCourseType
fetchPoolResolutions · deletePoolResolution
resolvePendingSession · updatePoolResolutionTarget · createPoolResolution
```

The last three were split out of a single `assignSessionToPool()` helper once it became clear the three operations have genuinely different semantics — resolve a pending session, change future assignments, or pre-declare an assignment before any session exists. A fourth, `reassignSingleSession`, existed briefly and was **deleted**: moving an already-deducted session between pools is no longer possible from the UI by design.

---

## 10. The cache layer

`src/lib/cache.ts` — a module-level `Map`, 60-second TTL, in memory only (a refresh clears it).

```ts
getCached<T>(key): T | undefined      // returns undefined once stale
setCached<T>(key, data): void
invalidateCache(...keys): void
invalidateCachePrefix(prefix): void
```

Cache keys are built from the filters and scope, e.g.:

```
sessionLogs:<teacherId>:<studentId>:<studentIds>:{"year":"2026","month":"3"}
```

**Prefix invalidation is the important part.** After any write, the hook drops *every* cached query for that table regardless of filters:

```ts
async function createSessionLog(input) {
  const { data, error } = await supabase.from("session_logs").insert(input).select().single();
  if (!error && data) {
    invalidateCachePrefix("sessionLogs:");     // every filter combination, gone
    setLogs(prev => [data, ...prev]);          // and optimistically local
  }
  return { data, error: error?.message ?? null };
}
```

Without that, a filtered list elsewhere in the app could keep serving a stale result for up to a minute after a write.

One special case: `invalidateTeachersCache()` is exported from `useTeachers.ts` and called by the add-teacher form, because `create-teacher-with-user` writes the row **server-side** — the hook never sees the insert, so `/admin/teachers`, `/admin/pcs` and `/admin/ccs` would render without the new person until the TTL expired.

---

## 11. Backend path A — direct to Postgres

Supabase exposes the tables over HTTP (PostgREST). A hook calls `supabase.from("session_logs").select(…)` and the request goes **from the browser straight to the database**. There is no API layer of ours in between.

This is safe because:

1. The client holds only the **anon key**, which grants nothing by itself.
2. The user's JWT rides on every request automatically.
3. The database reads the identity off that JWT and **RLS filters rows before returning them**.

So authorisation is expressed once, in SQL, rather than re-implemented per endpoint. A malicious client can send any query it likes; it gets back only rows the policies allow.

This path handles the overwhelming majority of traffic — every list, every detail view, every ordinary form save.

---

## 12. Backend path B — edge functions

Anything the browser must not be trusted with runs as a Deno function in `supabase/functions/`.

### The decision rule

> Does this need a secret, elevated privilege, or several writes that must succeed together?

If no → path A. If yes → an edge function. Most features never add one.

### Inventory

| Function | Lines | Trigger | Called from |
|---|---|---|---|
| `generate-homework-paper` | 1167 | Teacher clicks Generate | `useGeneratedPapers.ts:177` |
| `parse-homework-paper` | 1143 | Teacher uploads an existing paper | `useGeneratedPapers.ts:189` |
| `review-enrollment-payment` | 813 | Admin confirms/rejects payment | `useEnrollmentRequests.ts:178` |
| `grade-homework-submission` | 533 | Student submits; teacher re-grades | `useStudentAttempt.ts:127`, `useSubmissionGrade.ts:169` |
| `index-content-upload` | 411 | PDF uploaded as a source | `useContentUpload.ts:94` |
| `notify-package-threshold` | 239 | Session saved (non-no-show) | `SessionLogFormView.tsx` |
| `create-teacher-with-user` | 223 | Admin adds a teacher/PC/CC | `AdminTeacherFormPage.tsx:266` |
| `send-enrollment-invoice` | 221 | Enrollment submitted | `useEnrollmentRequests.ts:161` |
| `notify-pool-issue` | 206 | Session saved ambiguous | `SessionLogFormView.tsx` |
| `create-admin-with-user` | 181 | Admin adds an admin | `AdminAdminsPage.tsx:184` |
| `send-teacher-credentials` | 178 | Credential resend | admin surfaces |
| `notify-assignment-change` | 171 | Roster change | `lib/assignmentNotifier.ts` |
| `notify-homework-submitted` | 165 | Student submits | `useStudentAttempt.ts` |
| `submit-payment-proof` | 159 | Parent uploads proof | `PublicPaymentPage.tsx` — **direct `fetch`, no auth** |
| `notify-no-show` | 157 | No-show logged | `SessionLogFormView.tsx` |
| `notify-flag` | 157 | Session flagged for coach | `SessionLogFormView.tsx` |
| `notify-homework-grade-published` | 156 | Teacher publishes a grade | `useSubmissionGrade.ts` |
| `notify-homework-published` | 141 | Teacher publishes a paper | `useGeneratedPaper.ts` |
| `notify-renewal-request` | 131 | Coach files a renewal request | `useRenewalRequests.ts:65` |
| `update-user-email` | 124 | Any email change | `AuthContext.tsx:178`, `AdminTeacherFormPage.tsx:240` |
| `deactivate-teacher-with-user` | 113 | Admin deactivates staff | `useTeachers.ts:118` |

Note where the invocations sit: **most are called from hooks**, not components. The four fired from `SessionLogFormView.tsx` are the exception, because they depend on inspecting the *saved* row (was it a no-show? did it come back ambiguous?), which only the form knows at that moment.

### The security pattern — two clients

Every authenticated function does this, in this order:

```ts
// 1. A client carrying the CALLER's token — to establish who they are
const callerClient = createClient(url, anonKey, {
  global: { headers: { Authorization: authHeader } },
});
const { data: { user }, error } = await callerClient.auth.getUser();
if (error || !user) return json({ error: "Unauthorized" }, 401);

const profile = await …;                      // read their role
if (profile.role !== "admin") return json({ error: "Forbidden — admin only" }, 403);

// 2. ONLY THEN a service-role client, which bypasses ALL access rules
const serviceClient = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

The caller is identified and authorised using their **own** token before the unrestricted key is touched. Getting that order wrong would turn any function into a hole straight through RLS.

### Two deliberate exceptions

- **`submit-payment-proof` has no auth check at all** — public by design. A parent uploading a payment screenshot has no account. The unguessable token in `/pay/:token` is the access control. It's the only function in the codebase without a JWT check, and it's documented as such.
- **The `notify-*` functions take an id, not a payload.** They receive `{ session_log_id }` or `{ assignment_id }` and look up everything else with the service client. A caller therefore cannot address an email at an arbitrary person or invent its contents — recipient and body are both derived from the record. They also skip silently when the target has no email or is deactivated.

### `invokeEdgeFunction` — why not the raw client

`src/lib/edgeFunctions.ts` wraps `supabase.functions.invoke` with the same signature. Two behaviours, both from real failures:

1. **Real error messages.** supabase-js reports a failed function as a generic "non-2xx status code"; the actual `{ error: "…" }` body has to be read off `error.context`. `describeFunctionError()` does that.
2. **Dead-session recovery.** A local access token can look valid (not yet expired) while the server-side session behind it has been revoked — a second sign-in elsewhere, say. Plain table reads don't notice (PostgREST only checks signature and expiry), but edge functions call `auth.getUser()`, which checks session liveness and 401s. So on a 401 the wrapper refreshes the session and retries once; if the refresh also fails, it signs out and redirects to `/login?reason=session_expired` rather than leaving the user on an "Unauthorized" error.

---

## 13. File storage

Nine Supabase storage buckets. Uploads happen from hooks, except the session-summary doc which is generated inside the form.

| Bucket | Written by | Visibility |
|---|---|---|
| `payment-proofs` | `submit-payment-proof` (server) | private — signed URLs, admin only |
| `report-cards` | `useMyStudent`, enrollment form | private |
| `subject-notes` | `utils/subjectNoteFile.ts` | private — `<student_id>/<uuid>.<ext>` |
| `homework-content` | `useContentUpload`, `useGeneratedPapers` | private |
| `homework-answers` | `utils/homeworkAnswerMedia.ts` | private — student self-upload |
| `session-summaries` | `SessionLogFormView.tsx:95` | public URL |
| `session-invoices` | `useInvoices` | private |
| `pc-profiles` | `usePcProfile.ts:119` | **public** — profile photos |
| `avatars` | (legacy, unused) | — |

Bucket policies mirror the table policies: staff upload only into a real student's folder, a student reads only their own folder.

---

## 14. The Gemini integration

**Gemini is never called from the frontend.** Nothing in `src/` imports or references it. All four call sites are edge functions, and the API key is a Supabase secret.

### Call sites

All four `fetch` the REST endpoint directly — no SDK:

```
https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}
```

| Function | Line | Job |
|---|---|---|
| `generate-homework-paper` | `:490` | Generate questions, one call per block |
| `parse-homework-paper` | `:434` | Transcribe an uploaded/photographed paper |
| `grade-homework-submission` | `:162` | Grade written answers against the mark scheme |
| `index-content-upload` | `:231` | Index a PDF into chapters/sections |

Model defaults to `gemini-2.5-flash`, overridable per deployment via `GEMINI_MODEL`. PDFs upload separately through the Files API (`/upload/v1beta/files`) and are referenced by URI. Every call uses **structured output** (`responseSchema`), so responses are schema-conforming JSON rather than free text.

**Key rotation:** each function reads `GEMINI_API_KEY` plus optional `GEMINI_API_KEY_2` … `_8` — each expected to be a separate GCP project, so each carries its own quota. On a transient error the function sweeps across keys before failing.

### Where the prompts are written

Two places, and the split is deliberate.

**1. Hardcoded in the function files** — the mechanical instructions:

| Prompt | Location |
|---|---|
| `EXTRACTION_PROMPT` (paper transcription, ~40 dense rules) | `parse-homework-paper/index.ts:870` |
| `MULTI_PAGE_NOTE` | `parse-homework-paper/index.ts:913` |
| `STIMULUS_RECOVERY_NOTE` (retry nudge) | `parse-homework-paper/index.ts:923` |
| `OUTLINE_PROMPT` (PDF chapter indexing) | `index-content-upload/index.ts:219` |
| Grading prompt | `grade-homework-submission/index.ts:267` |
| Generation prompt assembly | `generate-homework-paper/index.ts:682` |

**2. In the database** — the pedagogical instructions. `style_templates.prompt_fragment` is a text column, one row per exam style (67 rows), seeded across four migrations beginning `20260716000000_seed_style_templates.sql`. Example — the IBDP Section A row:

> *"Write IB Diploma Programme Paper 1/2 Section A style structured questions. Each question opens with a precise IB command term ("State", "Outline", "Describe", "Explain", "Calculate", "Distinguish", "Suggest") whose depth matches the marks available… For every question provide a points-based mark scheme: one bullet per creditworthy point…"*

**The practical consequence: changing how a paper style is written is a database edit, not a code deploy.** Changing how transcription or grading works is a function redeploy.

### How the generation prompt is assembled

`generateOneBlock()` (`generate-homework-paper/index.ts:655`) concatenates seven pieces:

1. Role line — "You are generating a homework paper question block for a tutoring platform."
2. Style name and board
3. **`tpl.prompt_fragment`** ← the database row
4. Difficulty note
5. `sourceInstruction` (`:675`) — three distinct variants for session-log-only / PDF-only / **both**
6. `scopeNote` (`:1002`) — page ranges when the teacher scoped to chapters
7. `avoidNote` (`:817`) — every question already set for *this student*, built by `loadPriorPrompts()`, so generation doesn't repeat itself

Then four fixed rules: no A/B/C prefixes on options (the UI adds its own labels), question wording in English even for language papers, prompts must explicitly ask everything the mark scheme credits, and return exactly N as JSON.

### Two robustness behaviours worth knowing

- **The "both" bug.** With `content_source_type = "both"`, a PDF part was attached *and* `sourceText` was non-empty — but the old ternary collapsed to "only describe the session log", never telling Gemini a PDF existed. The PDF silently dominated. Now all three states get an explicit, distinct instruction, with a long comment explaining why.
- **Retry loops.** `parse-homework-paper` runs up to 3 extraction attempts, retrying with `STIMULUS_RECOVERY_NOTE` when the extracted questions cite line numbers or a case study but no `stimulus` came back — an observed failure mode where the model dropped the source passage. The best usable result so far is kept as a fallback so a failed recovery never loses the questions already found.

---

## 15. Logic that lives in the database

A meaningful amount of behaviour is SQL. The test applied each time: *if someone bypassed the app entirely, would this still need to hold?*

| Object | Does |
|---|---|
| `trg_create_user_profile` on `auth.users` | Creates the `public.users` row for **every** new login, however made — app, dashboard, or script. Why there is no such thing as a half-created account |
| `trg_prevent_privilege_escalation` | Blocks anyone editing their own role upward |
| `handle_session_log_package_lock()` | The hour-deduction and pool-resolution engine. Runs on write, so it cannot be skipped |
| `trg_prevent_session_log_change_in_locked_month` | Freezes a locked month against INSERT, UPDATE **and** DELETE |
| `prevent_locked_invoice_delete`, `prevent_locked_monthly_report_*`, `prevent_locked_report_stat_change` | Five more triggers protecting signed-off reporting data |
| `sync_teacher_staff_role()` | Keeps `users.role` in step with the coach/counsellor flags (PC → CC → teacher precedence) |
| `sync_coordinator_log_for_student()` | Files a new coordinator log by itself when a package's renewal state changes — no app code involved |
| `on_package_topup_inserted()` | Increments purchased hours and resets the 50/75/100% notification flags |
| Quarter-hour `CHECK` on `session_duration_hrs` | No route into the system can produce a 37-minute session |
| RLS on all 46 tables | Built on `is_admin()`, `my_teacher_id()`, `is_coach_or_counselor()`, `is_my_assigned_student()`, `can_view_student()` |

**The trade-off, stated plainly:** SQL is harder to read and harder to unit-test than TypeScript. It is used specifically where correctness must survive a bug in the app, a direct database edit, or a future second client. Everything else stays in TypeScript where it can be tested.

Note the **deliberate duplication**: the app checks the locked month (`isDateInLockedMonth` in `useMonthlyReports`) *and* the database enforces it. The app's check exists so the user gets a friendly message; the database's exists so the app being wrong cannot corrupt data.

---

## 16. Pure logic and the test suite

`src/utils/` holds the decision-making, extracted from components specifically so it can be tested without a browser, network or database. **376 tests across 30 files, ~4 seconds.** `vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]`.

| Module | Owns | Tested |
|---|---|---|
| `noShow.ts` | Which of the three no-show types bills the student, pays the teacher, or neither | ✅ |
| `sessionCoordinator.ts` | Which coach a session belongs to, and when the field must clear | ✅ |
| `staffRole.ts` | Coach/counsellor flags, panel shape, login-role precedence | ✅ |
| `staffRoster.ts` | Union of a person's PC and CC rosters — the UI mirror of `is_my_assigned_student()` | ✅ |
| `ccAssignment.ts` | Which students a person may log against | ✅ |
| `packageHours.ts`, `formatHours.ts` | Balance maths, hour display | ✅ |
| `reportAggregation.ts` | Sectioning a report into pool → subject → teacher | ✅ |
| `lockedMonths.ts` | Whether a date falls in a frozen month | ✅ |
| `homeworkGrading.ts` | Scoring, stage derivation, `paperDisplayName()` | ✅ |
| `assignmentNotifications.ts` | Which emails a roster change implies | ✅ |
| `profileCompletion.ts` | Whether a first-login gate should show (19 tests) | ✅ |
| `studentStatus.ts`, `engagementScore.ts`, `entityId.ts`, `localDate.ts`, `dateRangePresets.ts`, `analysisFilters.ts`, `subjectBranch.ts`, `subjectGrouping.ts`, `subjectLabel.ts`, `teacherSubjects.ts`, `sessionLogDisplay.ts`, `markdownBlocks.ts`, `lineNumberedText.ts`, `homeworkPaperFormat.ts`, `remarkMathGuard.ts` | assorted rules and formatting | ✅ |
| `buildInvoicePdf.ts` (1032), `exportHomeworkPaper.ts` (584), `buildSummaryDoc.ts`, `downloadSessionDocx.ts` | Document generation | ➖ |
| `subjectNoteFile.ts`, `homeworkAnswerMedia.ts`, `rasterizePdf.ts`, `teacherPeriodDetail.ts` | Touch storage/browser APIs | ➖ (logic extracted and tested separately) |

Test names state the **rule**, not the mechanics — `"No Show 1 pays the teacher nothing"`. The suite doubles as readable documentation of the business rules, which is deliberate: it's the fastest route for someone new to learn what the business does.

The project rule in `CLAUDE.md`: a feature ships with tests; a bug fix ships with a test that fails on the old behaviour. Modules that unavoidably touch Supabase or the browser are **excluded rather than mocked** — the practice is to pull the pure logic out and test that instead.

---

## 17. The type contract

`src/types/database.ts` — 1,145 lines — declares an interface per table and a union per enumerated column:

```ts
export type UserRole = "teacher" | "student" | "performance_coach" | "college_counselor" | "admin";
export type StudentStatus = "active" | "paused" | "completed";
export type NoShowType = "no_show_1" | "no_show_2" | "no_show_plus";
export type EnrollmentStatus = "pending_payment" | "payment_submitted" | "confirmed" | "rejected";
export interface SessionLog { … }
export interface SessionLogWithRelations extends SessionLog { … }
```

Every layer imports from that one file. So a column added in SQL becomes a field added here, and TypeScript then points at **every** place in the app that needs updating — a compile-time map of the blast radius of a schema change.

`npm run build` runs `tsc -b` before Vite bundles, so a type error fails the build rather than reaching production.

Composite types (`SessionLogWithRelations`, `InvoiceWithItems`, `EnrollmentRequestWithDetails`, `MonthlyReportWithStats`) are declared next to the hook that produces them, since they describe a join shape rather than a table.

---

## 18. End-to-end data flow traces

### 18.1 A teacher logs a session

The fullest path through the stack — nine files plus the database.

| # | File | What happens |
|---|---|---|
| 1 | `App.tsx` → `ProtectedRoute` → `TeacherSessionFormPage.tsx` | `/teacher/sessions/new` resolves; role confirmed as teacher/coach/counsellor |
| 2 | `useMyTeacherProfile()`, `useSubjects()` | Who this is, and which subjects they may pick. `useMyTeacherProfile` caches per user — every page mounts its own layout, and refetching made the sidebar settle a render late |
| 3 | `components/sessionLogs/SessionLogFormView.tsx` | The real form, `role="teacher"`. Pulls ~12 further hooks for its dropdowns |
| 4 | `utils/sessionCoordinator.ts`, `utils/ccAssignment.ts` | Pure functions decide which students are loggable and which coach the session belongs to. The coach is **derived** from the chosen student, rendered read-only, and clears itself when the student changes |
| 5 | `useMonthlyReports` → `isDateInLockedMonth()` | Refuses a date inside a locked month before submitting |
| 6 | `handleSubmit()` | Builds one payload. Normalises everything: offline work nulls the video link, no-shows null the duration and course type — so downstream billing sees exactly what it should |
| 7 | `useSessionLogs.createSessionLog()` | One insert. Invalidates `sessionLogs:` prefix, prepends to local state |
| 8 | **DB: RLS** | Insert accepted only if this person may write this row |
| 9 | **DB: CHECK + triggers** | Quarter-hour constraint → `prevent_session_log_change_in_locked_month()` → `handle_session_log_package_lock()` picks the pool (sticky resolution → pool-name match → else flag `pool_ambiguous`) and deducts |
| 10 | `notify-*` edge functions | The form inspects the **saved row** and fires what applies: `notify-package-threshold` or `notify-no-show`, plus `notify-flag` and `notify-pool-issue` if flagged/ambiguous. All `.catch(() => {})` |
| 11 | `supabase.from("subject_notes").insert(…)` | If a note or file was attached, uploaded via `utils/subjectNoteFile.ts` then written as a **separate** record — never stored on the session log. Best-effort |
| 12 | `navigate(backListPath)` | Back to a list reading a just-invalidated cache, so the new row is there |

Note where rules live: the 15-minute rounding, the locked month and the hour deduction are all enforced **in the database**. The form checks them too, only so the user gets a friendly message.

### 18.2 Login

| # | File | What happens |
|---|---|---|
| 1 | `pages/LoginPage.tsx` → `useAuth().signInWithUsername()` | Form collects a **username**, not an email |
| 2 | **DB:** `get_email_for_username()` via `supabase.rpc` | Resolves username → the Auth login email. Reads `auth.users.email`, not the mutable copy |
| 3 | `supabase.auth.signInWithPassword()` | Supabase Auth verifies the password. We never wrote hashing |
| 4 | `AuthContext.loadProfile()` → `public.users` | Loads `role`. A deactivated account is signed straight back out with an explanation |
| 5 | `ProtectedRoute` reads `profile.role` | Redirects to that role's own dashboard. No "choose your dashboard" step |

From then on the session token attaches to every request automatically. **No component ever handles a token.**

### 18.3 Enrollment → payment → account creation

The longest flow, and the one that crosses the public boundary.

```
AdminEnrollStudentPage.tsx
  → useEnrollmentRequests.create…()           insert enrollment_requests
                                              + enrollment_request_packages (one per package)
  → utils/buildInvoicePdf.buildEnrollmentInvoicePdf()   PDF built CLIENT-SIDE
  → invokeEdgeFunction("send-enrollment-invoice", { …, pdfBase64 })
        └ emails invoice + PDF + /pay/:token link to the "send updates to" address

── public boundary ──────────────────────────────────────────────

PublicPaymentPage.tsx                          no layout, no hook, no auth client
  → fetch(`${SUPABASE_URL}/functions/v1/submit-payment-proof`)
        └ writes enrollment_request_payment_proofs (one row per file)
          → payment-proofs bucket (private)
        └ status → payment_submitted

── back inside ──────────────────────────────────────────────────

AdminEnrollmentsPage.tsx
  → useEnrollmentRequests.review…()
  → invokeEdgeFunction("review-enrollment-payment")     813 lines, service-role
        ├ new student  → creates auth.users (trigger makes public.users)
        │                + students row + every package on the request
        │                + emails credentials and one combined confirmation
        ├ renewal      → tops up unlocked package per line, or starts a fresh
        │                one if locked; emails one combined confirmation
        └ closes any matching package_renewal_requests → "Renewed" + emails the coach
```

The PDF being built in the browser and passed as base64 is worth noting: it reuses `buildInvoicePdf.ts`, the same module the report PDFs use, so branding stays identical without duplicating it server-side.

### 18.4 Homework generation

```
TeacherHomeworkPage.tsx  (1000 lines — the builder)
  ├ SessionLogPicker.tsx      pick a session as the source
  ├ useContentUpload.uploadAndIndex()
  │     → homework-content bucket
  │     → invokeEdgeFunction("index-content-upload")
  │           └ Gemini → content_uploads.outline (chapters/sections)
  ├ ContentScopePicker.tsx    tick chapters → generated_papers.content_scope
  └ useGeneratedPapers.createDraftPaper()      status = "draft"
        → invokeEdgeFunction("generate-homework-paper")
              ├ resolves style_templates → tpl.prompt_fragment
              ├ builds the block prompt (§14)
              ├ Gemini per block, structured output, dedup vs question_bank
              └ writes generated_papers.questions_json
        (the list polls, showing "Generating…" or "Generation failed" + Retry)

TeacherHomeworkReviewPage.tsx
  → useGeneratedPaper: saveQuestions() · regenerate(question|block|paper) · publish()
        publish() → status published + published_at
                  → notify-homework-published (fire-and-forget)

StudentHomeworkAttemptPage.tsx
  → useStudentAttempt: saveAnswers() upserts submissions.answers_json
                       submit() locks it, then
                       → invokeEdgeFunction("grade-homework-submission")
                             ├ mcq / true_false / fill_blank  → auto-graded exactly
                             ├ subjective                     → Gemini per mark-scheme point
                             └ photo / whole-paper PDF        → NEVER AI-graded, pending
                       → notify-homework-submitted

back on the review page
  → useSubmissionGrade: overrideMark() · saveAnnotations() · setWholePaperMark() ·
                        regrade() · publishGrade()
        publishGrade() sets grades.published_at   ← the student sees NOTHING until this
                       → notify-homework-grade-published
```

The two human gates are the point: a paper is a draft until a teacher confirms it, and a grade is invisible until a teacher publishes it — **the second is enforced by RLS (`grades.published_at is not null`), not merely hidden in the UI**.

### 18.5 The coordinator log that writes itself

The only flow with no frontend involvement at all.

```
student_packages.notified_75_pct_at crosses          ─┐
package_renewal_requests inserted/updated            ─┤→ DB trigger
                                                      │
                          sync_coordinator_log_for_student()
                                                      │
        inserts a NEW coordinator_logs row: today's date, everything else
        carried forward from the latest log, is_automated = true,
        attributed to the assigned coach
                                                      │
                       trg_coordinator_logs_snapshot_statuses
                                                      │
              writes coordinator_log_package_statuses (one row per package)
```

`coordinator_log_package_status_rows()` computes each package's state: below 75% → *Not Due*; 75%+ → *Upcoming*; an open matching request → *In Discussion*; fulfilled → *Renewed*; 100% with nothing in motion → *Not Renewing*. Plus "phantom" rows for open requests against a course type the student holds no package for.

The frontend only ever *reads* these — `CoordinatorLogHistoryList.tsx` and `RenewalSection` render them. The append-only history is therefore the dated record of what changed and when.

---

## 19. Cross-cutting conventions

**Errors are values.** Every hook mutator returns `{ data, error: string | null }`. Nothing throws across a layer boundary. Components render the message inline.

**Fire-and-forget for notifications.** Every `notify-*` invocation is `.catch(() => {})`. The database write has already succeeded, so a slow or failing SMTP round trip can never fail the operation or block the user. A failed email is recoverable; a failed save is not.

**Best-effort side effects.** The subject note attached to a session log, and the assignment notification, both follow the same rule: the primary write completes first, and the secondary failure is swallowed.

**Optimistic local state + prefix cache invalidation.** Every mutator does both.

**Derived, not chosen.** Where a value can be computed from another, it is rendered read-only rather than offered as a picker — the session's coach (derived from the student), the coordinator log's programs (derived from the student's packages). The rules live in tested utils.

**Append-only where history is the asset.** `coordinator_logs` has no edit route and no `:id/edit`; each save is a new row prefilled from the latest.

**Naming.** `use*` hooks, `*View` shared components, `*Page` route files, `*Layout` chrome, `Admin*`/`Teacher*`/`Student*` prefixes on pages, `fetch*ById` for standalone reads, `notify-*`/`create-*`/`send-*`/`review-*` for edge functions.

**Comments explain *why*, and often name the bug.** Several of the longest comments in the codebase (the "both" source instruction, the tab-focus guard, the `get_email_for_username` note, the pool re-resolution guard) exist to stop a specific regression recurring. Treat them as load-bearing.

---

## 20. Build, deploy and configuration

Three tracks deploy independently.

| Track | Command / mechanism | Notes |
|---|---|---|
| Frontend | `npm run build` = `tsc -b && vite build` → Vercel on push to default branch | `vercel.json` rewrites all paths to `index.html` (client-side routing) |
| Edge functions | Deployed per function | Independently versioned — `generate-homework-paper` is on v18, `grade-homework-submission` on v12 |
| Database | New timestamped file in `supabase/migrations/`, applied through the tracked path | Never edit a past migration |

```
npm run dev        vite dev server
npm run build      tsc -b && vite build
npm run lint       eslint .
npm test           vitest run          ← must be green before a change is done
npm run test:watch vitest
```

### Configuration

| Where | Variables |
|---|---|
| Frontend (Vercel / `.env`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Edge function secrets | `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_HOST/PORT/USER/PASS/FROM`, `GEMINI_API_KEY` (+ `_2`…`_8`), `GEMINI_MODEL` |

Nothing is hardcoded. `supabaseClient.ts` warns at startup if either frontend variable is missing, rather than rendering a blank screen.

### Dependencies of note

`@supabase/supabase-js` · `react` 19 · `react-router-dom` 7 · `recharts` (analysis) · `jspdf` + `jspdf-autotable` (invoices) · `docx` (Word export) · `pdfjs-dist` (client-side PDF rasterisation) · `react-markdown` + `remark-gfm`/`remark-breaks`/`remark-math` + `rehype-katex` + `katex` (transcribed-paper rendering) · `tailwindcss` · `vitest`.

---

## 21. Adding a feature — the checklist

| # | File | Why |
|---|---|---|
| 1 | `supabase/migrations/<timestamp>_add_x.sql` | Table/column **and its RLS policies**. Applied through the tracked path, never ad hoc SQL |
| 2 | `src/types/database.ts` | Add the interface. TypeScript now shows every place that must change |
| 3 | `src/hooks/useX.ts` | One hook: query, cache key, mutators returning `{ data, error }` |
| 4 | `src/utils/x.ts` + `x.test.ts` | Any decision-making, as a pure function, with tests. **Not optional** per `CLAUDE.md` |
| 5 | `src/components/<feature>/XView.tsx` | The screen, once, built to serve every role that needs it |
| 6 | `src/pages/<role>/XPage.tsx` | A thin wrapper per role, usually under 30 lines |
| 7 | `src/App.tsx` | One route, wrapped in `ProtectedRoute` with the allowed roles |
| 8 | `<Role>Layout.tsx` | A nav entry, if it needs one |
| 9 | `supabase/functions/…` | **Only** if a secret or elevated privilege is involved. Most features skip this |
| 10 | `README.md`, `db/docs/VERIFIED_DATABASE_STATE.md`, `db/README.md` | Documentation is part of the change, not a follow-up |
| 11 | `npm test` | Green, or the change isn't finished |

Most features touch six or seven files and add no infrastructure.

---

## 22. Historical scars worth knowing

Things that look odd until you know why.

- **Two migration systems once existed** (`db/schema/*.sql` and `supabase/migrations/`), silently diverged from each other and from the live database — 63 files. Both were deleted and replaced with one baseline generated from live introspection. **Verify the live database before writing a migration**; don't trust the files alone.
- **RLS needs base `GRANT`s.** Policies were once correct while zero grants meant every request was blocked before RLS was even evaluated. When "the policy looks right but it's still denied", check the grants.
- **`reassignSingleSession` was deleted on purpose.** Moving an already-deducted session between pools is not possible from the UI. Don't reintroduce it without understanding why.
- **Sticky pool resolution is checked *before* the subject-name match.** Reversed, a coach manually reassigning a session would have it snapped back on the next write.
- **An already-deducted session is never re-resolved.** A later unrelated edit (fixing a typo, changing a date) can't silently drag a historical session onto a different pool.
- **`assigned_by_teacher_id` was tried and dropped.** Ascend Offline Work reuses `coordinator_teacher_id` with a relabelled field instead.
- **`session_no` was dropped entirely** rather than automated. No running-count column exists.
- **The parent role and `/parent/*` portal were deleted.** A student and their guardian share one login; the guardian's name/phone are plain fields on `students`.
- **`teachers.email` stays globally unique**, and deactivation never frees it — reactivating later would otherwise return a broken email if the address had been reused.
- **`educator_experience` on `pc_profiles` is unused.** The section was removed; the column remains, always empty.

---

*Written against the default branch. Structural counts verified from the repository: 69 pages, 62 components, 40 hooks, 35 utils, 21 edge functions, 114 migrations, 376 tests across 30 files.*

# Hours & Revenue Logic

**Written 2026-07-01.** This is the single place that explains how logging a session translates into "teacher hours" and "student package hours" (what the app's UI calls "Monthly Revenue" — see the note at the bottom on why those are the same number). If you add a new program type or change this logic, update this file — see `CLAUDE.md`.

---

## The two independent counters

Every session log feeds **two completely separate calculations**, and it's easy to assume they're linked when they aren't:

1. **Teacher hours** — "how many hours has this teacher logged, period." Always counted, for every session type, with no exceptions. Computed by `fetchTeacherPeriodDetail()` in `src/utils/teacherPeriodDetail.ts`, which sums `session_duration_hrs` for every non-no-show `session_logs` row matching `teacher_id`, over a date range. It never looks at `course_type_id`, `program_type_id`, or `student_id`. This is what powers the admin "Teacher Hours" report and the teacher-facing "My Hours" page.

2. **Student package hours** ("Monthly Revenue" in the UI) — "how many of this student's purchased hours has this session used up." Only counted when the session log has both a `student_id` **and** a `course_type_id` that matches one of that student's `student_packages` rows. Computed by `computeHoursUsed()` in `src/hooks/useStudentPackages.ts`, which sums `session_duration_hrs` for sessions matching a given `student_id` (via the caller's query) and `course_type_id`, excluding no-shows.

   **Since 2026-07-02**, `computeHoursUsed()` also accepts an optional `studentPackageId` and, when given, prefers matching `session_logs.student_package_id === studentPackageId` over the plain `course_type_id` match. This matters because a student can now have more than one `student_packages` row for the same course type over time (see package locking in `db/README.md`) — without scoping by the specific package id, a locked package's historical hours would keep bleeding into a fresh renewal's balance. `student_package_id` is auto-populated by a DB trigger (`handle_session_log_package_lock()`), not by the session-log forms, so no change was needed there. All current callers (`AdminStudentsPage`, `AdminPackagesPage`, `AdminStudentDetailPage`, `TeacherStudentDetailPage`) pass the package's own `id`.

**The only thing that controls whether a session touches a student's package is whether the session-log form sets `student_id` and `course_type_id` on that row.** There is no separate "does this count as revenue" flag — it falls out entirely of those two columns.

### Stored `hours_used` (added 2026-08-01)

As of 2026-08-01 the per-package "used hours" total is also **stored** on `student_packages.hours_used` and maintained DB-side by the `recompute_package_hours_used()` trigger (`AFTER INSERT/UPDATE/DELETE ON session_logs`), rather than only ever being recomputed on the client. It holds exactly what `computeHoursUsed()` computes when scoped to a package (`SUM(session_duration_hrs)` of the package's linked sessions, excluding No Show 1/2), including correctly following session edits, deletes, and moves between packages. The frontend now reads this stored column for the **headline per-package balance** (`StudentDetailView`, `StudentsListView`, `StudentPackagesView`, `AdminPackagesPage`); `computeHoursUsed()` and the per-subject / per-teacher breakdowns (`computeHoursUsedBySubject` / `computeHoursUsedByTeacher`, still summing session rows) are unchanged and remain the reference the stored value is defined to equal. See `supabase/migrations/20260801000000_stored_package_hours_used.sql`.

---

## What each program type sets, and why

This table is the actual current behavior, verified against `db/docs/VERIFIED_DATABASE_STATE.md`'s live `program_types` snapshot and the `selectedCourseType`/`studentInvolved` derivation in `src/components/sessionLogs/SessionLogFormView.tsx` — as of 2026-07-05 this single shared component backs both `TeacherSessionFormPage.tsx` and `AdminSessionLogFormPage.tsx` (previously two separate components with duplicated logic, kept in sync manually); see `db/docs/VERIFIED_DATABASE_STATE.md`'s 2026-07-05 changelog entry for what still differs between the two roles.

| Program type | `student_id` set? | `course_type_id` set to | Teacher hours | Student package hours |
|---|---|---|---|---|
| **Academics** (`academic`) | Yes | `Academic` | ✅ always | ✅ deducts from Academic package |
| **Beyond Academics** (`beyond_academic`) | Yes | `Beyond Academic` | ✅ always | ✅ deducts from Beyond Academic package |
| **Demo Lesson** (`demo_lesson`) | Yes (for record-keeping) | *(none — no course type is named "Demo Lesson")* | ✅ always | ❌ never (no course_type match, so `computeHoursUsed` never counts it) |
| **Ascend Offline Work** (`ascend_offline_work`) | No (`studentInvolved = false`) | *(none, explicit)* | ✅ always | ❌ never (no student, no course type) |
| **Academic Offline Work** (`academic_offline_work`, sub-type of Student Offline Work) | Yes | `Academic` (explicit override) | ✅ always | ✅ deducts from Academic package |
| **Beyond Academic Offline Work** (`beyond_academic_offline_work`, sub-type of Student Offline Work) | Yes | `Beyond Academic` (explicit override) | ✅ always | ✅ deducts from Beyond Academic package |

`Student Offline Work` itself (the top-level group, `student_offline_work`) is never stored as a `program_type_id` — since it has sub-types, `effectiveProgramTypeId` always resolves to whichever child (Academic/Beyond Academic Offline Work) was picked. Same pattern `Academics`/`Beyond Academics` use for their own subject/curriculum pickers — the group is a UI-only concept, never a stored value.

### Where this lives in code

In both session-log form components:

```ts
// Ascend Offline Work: no student, no billing.
const isAscendOfflineWork = selectedTopLevelType?.type === "ascend_offline_work";
const studentInvolved = !isWorkForAscendType && !isAscendOfflineWork;

// Academic/Beyond Academic Offline Work explicitly override which course
// type they bill against, since their *top-level* type ("Student Offline
// Work") doesn't map to a course type on its own — only the sub-type does.
const selectedCourseType = isAscendOfflineWork
  ? null
  : isAcademicOfflineWork
    ? courseTypes.find((ct) => ct.name === "Academic") ?? null
    : isBeyondAcademicOfflineWork
      ? courseTypes.find((ct) => ct.name === "Beyond Academic") ?? null
      : selectedTopLevelType
        ? courseTypes.find((ct) =>
            ct.name === (selectedTopLevelType.type ? PROGRAM_TYPE_TO_COURSE_TYPE_NAME[selectedTopLevelType.type] : undefined) ||
            ct.name === selectedTopLevelType.name
          ) ?? null
        : null;
```

`PROGRAM_TYPE_TO_COURSE_TYPE_NAME` only maps `academic → "Academic"` and `beyond_academic → "Beyond Academic"`. Every other top-level type (`demo_lesson`, `ascend_offline_work`, `student_offline_work`, `work_for_ascend_now`) falls through to the name-equality fallback (`ct.name === selectedTopLevelType.name`), which only matches if a `course_types` row happens to share that exact name — none do for these, so they correctly resolve to `null` unless explicitly overridden (as the two offline sub-types are).

---

## A latent gap, left as-is (harmless for now)

`computeHoursUsed()` accepts an optional `programTypeIds` fallback set, used **only** when a session log's `course_type_id` is `null` — meant to catch sessions logged before the `course_type_id` column existed. That fallback set is built per-page (`AdminStudentDetailPage.tsx`, `TeacherStudentDetailPage.tsx`, `AdminPackagesPage.tsx`) by walking `program_types` and mapping each one's **top-level parent's** `type` through `PROGRAM_TYPE_TO_COURSE_TYPE_NAME`. Since `Academic Offline Work` / `Beyond Academic Offline Work`'s parent is `Student Offline Work` (`type = student_offline_work`, not in the map), they're never added to this fallback set.

In practice this doesn't matter: the fallback only exists for *legacy* rows missing `course_type_id`, and these two program types didn't exist before `course_type_id` did — every session logged against them will always have `course_type_id` set directly by the form logic above, so the primary match (`s.course_type_id === courseTypeId`) always applies and the fallback path is never reached for them. Documented here rather than "fixed" so it isn't rediscovered as a mystery later — see `db/docs/VERIFIED_DATABASE_STATE.md` for the general stance on not silently patching things that aren't currently broken.

---

## "Monthly Revenue" is student package hours, not currency

The admin Reports page has a "Monthly Revenue" tab (`AdminReportsPage.tsx`), and there's a `buildMonthlyRevenuePdf` export. Despite the name, **there is no dollar-rate or price-per-hour computation anywhere in this codebase.** "Revenue" here means the same thing as "student package hours" above — billable hours logged against a student, broken out by course type/subject/curriculum. If per-hour billing rates are ever introduced, this file and that report need to be revisited together.

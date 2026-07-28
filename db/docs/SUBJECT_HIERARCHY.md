# Ascend Now — Subject Hierarchy Reference

**This is the single source of truth for how subjects are structured and picked throughout the app.** Read this before touching anything subject-related (admin panel, teacher panel, session logs, teacher-creation forms). It exists so the hierarchy only has to be explained once — when it changes, update this file **and every file in the registry below in the same change**, per `CLAUDE.md`'s doc-sync rule.

Companion doc: [`db/docs/VERIFIED_DATABASE_STATE.md`](./VERIFIED_DATABASE_STATE.md) is the authoritative column-by-column schema dump — this file is the *conceptual* map of how those tables compose into the picking UI teachers/admins actually see.

---

## 1. The three top-level branches

Every subject lives under exactly one of three branches:

- **`academic`** — real curricula (IBDP, IGCSE, AP, AS & A Levels, Standard Tests, …). Picked as **Curriculum → (Group →) Subject**.
- **`beyond_academic`** — Passion Projects, Career Exploration, Book Publishing, Finance and Literacy, Podcast, etc. Picked as a **single flat Subject dropdown, with no grouping of any kind** — every Beyond Academic subject, including "Passion Projects" and "Career Exploration" themselves, is a peer of every other one.
- **`college_counselling`** — College Counselling, College Essays. As of 2026-07-09, picked exactly the same way as Beyond Academic: a single flat Subject dropdown, no grouping. See §3b.

This split also drives `program_types` (`Academics` / `Beyond Academics` / `College Counselling`, the top-level dropdown in both session-log forms) and `course_types` (`Academic` / `Beyond Academic` / `College Counselling`, which package hours get billed against). Keep these in sync conceptually even though they're separate tables — see §5.

Which `subjects.category` value(s) count as which branch is **not** a clean 1:1 mapping — see the important caveat at the top of §3.

---

## 2. Academic branch: Curriculum → (Group →) Subject

```
curricula                (e.g. "IBDP", "IGCSE", "Standard Tests")
  └─ curriculum_groups    (e.g. "Sciences" under IBDP)  — OPTIONAL, see below
       └─ subjects        (curriculum_group_id set)
  └─ subjects              (curriculum_id set directly)  — only when the curriculum has NO groups
```

**A subject sets exactly one of `curriculum_group_id` / `curriculum_id`, never both.** Which one depends on whether the curriculum has any `curriculum_groups` rows at all:

- **Curricula with real sub-grouping** (IBDP, IGCSE, AP, AS & A Levels, …): subjects hang off a `curriculum_groups` row (`subjects.curriculum_group_id`). The picking UI is **Curriculum → Subject Group → Subject**.
- **Curricula with no meaningful grouping** — currently just **Standard Tests** (ACT/SAT/TOEFL/IELTS as four plain subjects) — have zero `curriculum_groups` rows, so their subjects attach straight to the curriculum via `subjects.curriculum_id`. The picking UI is **Curriculum → Subject** (the "Subject Group" step is skipped entirely — code checks `hasGroups` / `isUngroupedCurriculum`).
- **"Other" bucket**: both `curriculum_group_id` and `curriculum_id` null. Used for academic subjects with no specific curriculum.

**Rule for a new curriculum:** if it's a single standardized thing with no sub-breakdown (like a standalone exam), don't create `curriculum_groups` for it — attach subjects directly via `curriculum_id`. If it genuinely has sub-categories worth separating (like IBDP's subject groups), use `curriculum_groups`.

### SL/HL and other levels

There is **no enum** for level — `subjects.level` is free text (`'Standard Level'`, `'Higher Level'`, `'Advanced Subsidiary Level'`, etc.). A subject that comes in multiple levels is **multiple separate `subjects` rows** sharing the same `name`/`board`/`subject_code` but a different `level`.

**The level must always be picked as its own dropdown step, never baked into the subject name/label as one flat list.** The pattern is:
1. Group subjects sharing `name`/`board`/`subject_code` (`groupSubjectsByBase()` in `src/hooks/useCurriculumGroups.ts`).
2. Let the user pick the subject name once.
3. If that group has more than one item, show a second **"Level"** dropdown with the raw `level` values.

This is implemented once as `src/components/ui/SubjectLevelSelect.tsx` — **reuse this component everywhere a user picks an academic subject that might have levels.** Do not build a flat one-dropdown-per-level-variant picker; that's the exact inconsistency this doc exists to prevent.

Three label formats exist for *display* (not picking) — pick the one that matches context, don't invent a fourth:
- `subjectDisplayLabel()` (`useCurriculumGroups.ts`) — full label with level spelled out, e.g. `"Math — Cambridge (9709) — Standard Level"`. Used for read-only labels (assigned-subject pills, session-log subject labels).
- `subjectBaseLabel()` (`useCurriculumGroups.ts`) — same without the level, used as the first-step dropdown label inside `SubjectLevelSelect`.
- `subjectLabel()` / `levelAbbrev()` (`src/utils/subjectLabel.ts`) — abbreviates level to `SL`/`HL`/`AS`/`A2`/etc. Used in reports/invoices/hours pages where space is tight.

---

## 3. Beyond Academic branch: flat Subject picker, no grouping at all

```
subjects (category = 'beyond_academic' or anything other than 'academic'/'college_counselling', category_id = NULL)
```

**Important caveat, verified live 2026-07-09:** `subjects.category` is genuinely inconsistent free text for this branch — live data has *three* distinct values in active use (`beyond_academic`, `passion_projects`, `profile_building`), none of which is a reliable "the beyond-academic literal" on its own. Every "is this Beyond Academic?" check in the app is therefore the loose catch-all `category !== 'academic'`, **not** `category === 'beyond_academic'`. As of 2026-07-09, that catch-all also excludes `category !== 'college_counselling'` (§3b's new distinct value) — do not narrow it any further than that, and do not assume any other specific string for "the" Beyond Academic category.

**As of 2026-07-02 (later), Beyond Academic subjects are ONE completely flat list — no sections, no categories, not even an `<optgroup>` label.** Every Beyond Academic subject is a peer: "Passion Projects" and "Career Exploration" are themselves plain `subjects` rows a teacher can pick directly, sitting alongside "Book Publishing", "Finance and Literacy", "Podcast", "Creative Writing", etc. — not headers that group other subjects underneath them. This went through two iterations:
1. First (2026-07-02, earlier that day): kept `subject_categories` as a grouping layer, but collapsed the *picking flow* from a required two-step "Section → Subject" click-through to one dropdown with the category shown only as an `<optgroup>` label.
2. Then (2026-07-02, later that day): removed the grouping layer entirely, since an `<optgroup>` is still a hierarchy — the requirement is that there is none. `subjects.category_id` is `NULL` for every Beyond Academic subject now; the old "Passion Projects"/"Career Exploration" `subject_categories` rows were deactivated (their name became a plain subject instead) rather than deleted, matching how other legacy categories (`College Support`, `Computer Science`, `Communication skills`, `Music`) are handled.

The shared `src/components/ui/BeyondAcademicSubjectSelect.tsx` component takes a flat `options: { value, label }[]` list (sorted alphabetically) and renders one `<select>` with plain `<option>`s — no `categories` prop, no grouping logic. Every one of the five picker files in §4 filters "is this subject beyond-academic?" with the loose `subject.category !== 'academic'` text check (not a `category_id`/`subject_categories.type` join), consistent with how it already worked before subjects had a `category_id` at all. The three "pick a subject to newly assign" flows (`TeacherSubjectsPage.tsx`, `AdminTeacherSubjectsPage.tsx`, `AdminTeacherFormPage.tsx`) additionally require `category_id IS NULL` — a non-null `category_id` today only ever means the subject is still linked to one of the legacy, deactivated categories (Computer Science, Communication skills, Music, College Support), and those shouldn't become newly assignable again just because the flat picker stopped checking category activity directly. The two session-log forms don't need this extra check since they only ever list subjects a teacher is *already* assigned (`teacher_subjects`), not new ones to pick.

**`subject_categories` still exists as a table** (still used for the `academic` branch's own category concept in a couple of admin flows — see §5), but no active row of `type='beyond_academic'` is used for picking, grouping, or filtering purposes anywhere any more.

**Rule for a new Beyond Academic subject:** just add a new active `subjects` row with `category_id = NULL` and `category` set to anything other than `'academic'` (e.g. `'beyond_academic'`) — via the admin Subjects Library "Beyond Academics" tab (now a flat add/edit/deactivate list, no "sections"), or a migration if it needs to be seeded/guaranteed. No code change needed.

**Do not reintroduce any grouping step or `<optgroup>` for Beyond Academic.** If a future request asks for that, treat it as a deliberate reversal, not a small tweak — it undoes the 2026-07-02 flattening (both iterations) and needs updating in every file in §4, not just one.

---

## 3b. College Counselling branch: flat Subject picker, same shape as Beyond Academic

```
subjects (category = 'college_counselling', category_id = NULL)
```

**As of 2026-07-09**, College Counselling moved from a `program_types` parent/child hierarchy (top-level "College Counselling" with two sub-programs, also named "College Counselling" and "College Essays") to this shape instead — mirroring Beyond Academic exactly: a standalone top-level `program_types` row (`type = 'college_counselling'`, unchanged, id 31) with no active children, and its two former sub-programs (`program_types` ids 32/33, now deactivated — not deleted, since retiring them is safe only because zero `session_logs` referenced them, verified live before the change) living as two plain `subjects` rows instead. Picked from a **"College Counselling" tab** in the Subjects Library (`SubjectsLibraryContent.tsx`), one flat dropdown, no grouping — same UI component (`BeyondAcademicSubjectSelect`) Beyond Academic already uses.

`college_counselling` is a **new, distinct `category` value** — not folded into the existing loose "not academic" Beyond Academic bucket described in §3's caveat. Every place that filters "Beyond Academic subjects" via `category !== 'academic'` was updated to also exclude `category !== 'college_counselling'`, and a parallel `category === 'college_counselling'` branch was added alongside it, reusing the exact same flat-picker pattern.

**A separate page, `src/pages/admin/AdminProgramTypesPage.tsx` (`/admin/program-types`), manages `program_types` rows directly** and needed its own fix, independent of the subject-picking files in §4: it buckets every top-level type into "Standalone Types" vs. "Sections with Sub-programs" via `isSectionType()`, which (before this change) treated a type as a section if it had *any* child rows at all, active or not — so College Counselling kept showing as an (empty) section after ids 32/33 were deactivated, since the rows still exist with `parent_id = 31`. Fixed by adding `college_counselling` to that file's `BEHAVIORAL_TYPE_VALUES` set (types whose `type` always makes them standalone, regardless of leftover inactive children) and making that check an unconditional early-return rather than one half of an `||`. If a future change deactivates-not-deletes another behavioral type's children, add its `type` value to that same set rather than special-casing it further.

**What did *not* change:** `course_types` still has exactly one "College Counselling" row, and the All-In-One bundle still creates exactly one unlabeled 40-hour College Counselling pool (`bundle_pool_settings`, `pool_label = NULL`) — packages/billing treat College Counselling as one whole course type, same as before. New College Counselling sessions do now carry a real `subject_id` (they never did before), which simply means the various "no subject → fall back to program name" branches elsewhere in the app (`sessionTopicLabel()`, `aggregateReportSections()`, `notify-pool-issue`, invoice line-item grouping) stop being exercised for *new* sessions — they're all already generic on "does this row have a subject", so none needed code changes; they still apply as before to historical pre-2026-07-09 rows.

**Rule for a new College Counselling subject:** same as Beyond Academic (§3) — add an active `subjects` row with `category_id = NULL` and `category = 'college_counselling'`, via the Subjects Library's "College Counselling" tab or a migration. No code change needed.

---

## 4. File registry — update ALL of these together when the hierarchy changes

| # | File | Role |
|---|---|---|
| 1 | `src/components/ui/SubjectLevelSelect.tsx` | Shared two-step Subject → Level picker for **academic** subjects. |
| 2 | `src/components/ui/BeyondAcademicSubjectSelect.tsx` | Shared flat picker component — no grouping/`<optgroup>` at all. Used for **both** Beyond Academic and (as of 2026-07-09) **College Counselling** subjects; the name is legacy, the component itself is generic. |
| 3 | `src/hooks/useCurriculumGroups.ts` | `groupSubjectsByBase()`, `subjectDisplayLabel()`, `subjectBaseLabel()` — the label/grouping logic both pickers above rely on. |
| 4 | `src/utils/subjectLabel.ts` | Abbreviated SL/HL-style labels for reports/invoices. |
| 5 | `src/components/subjects/SubjectsLibraryContent.tsx` | Admin-only "Subjects & Curricula" management UI (`/admin/subjects`) — where curricula/groups/categories/subjects are actually created/renamed/deactivated. As of 2026-07-09, `FlatSubjectsTab` (formerly `BeyondAcademicsTab`) is parameterized by category so it's shared by both the "Beyond Academics" and "College Counselling" tabs. As of 2026-07-28, this is admin-only — performance coaches lost their equivalent `/teacher/subjects-library` route/page (`CoachSubjectsManagePage.tsx`, deleted) since PCs are no longer allowed to add subjects to the catalog. |
| 6 | `src/components/sessionLogs/SessionLogFormView.tsx` | The actual shared session-log add/edit form — subject picking scoped to the selected teacher's own `teacher_subjects`. `src/pages/teacher/TeacherSessionFormPage.tsx` and `src/pages/admin/AdminSessionLogFormPage.tsx` are both thin wrappers that render this component (not duplicated logic — that was true historically but is stale; see this file's own doc comment). |
| 7 | `src/components/subjects/TeacherSubjectEditor.tsx` | Shared "assign/remove subjects for a teacher" widget, used by both `src/pages/teacher/TeacherSubjectsPage.tsx` (self-service "My Subjects") and `src/pages/admin/AdminTeacherSubjectsPage.tsx` (admin managing any teacher). |
| 8 | `src/pages/admin/AdminTeacherFormPage.tsx` | Admin create/edit teacher form (`/admin/teachers/new`, `/admin/teachers/:id/edit`) — embeds subject assignment inline, in both create and edit mode. Does **not** use `TeacherSubjectEditor` (#7) — its own separate, duplicated inline logic. |
| 9 | `src/components/students/StudentDetailView.tsx` | `candidateSubjectsForCourseType()` — filters the subject dropdown on the "add teacher/subject → project assignment" (pool-resolution rule) form to the subjects that belong to the chosen pool's course type. |
| 10 | `src/hooks/useSubjects.ts`, `useSubjectsByGroup`, `useAllSubjects` | Data fetching/mutation for `subjects`. |
| 11 | `src/hooks/useCurricula.ts` | Data fetching/mutation for `curricula`. |
| 12 | `src/hooks/useSubjectCategories.ts` | Data fetching/mutation for `subject_categories`. |
| 13 | `src/hooks/useTeachers.ts` (`useTeacherSubjects`, `useAllTeacherSubjects`) | Junction table (`teacher_subjects`) CRUD. |
| 14 | `src/types/database.ts` | `Subject`, `SubjectCategory`, `Curriculum`, `CurriculumGroup`, `TeacherSubject` TypeScript shapes. |
| 15 | `db/docs/VERIFIED_DATABASE_STATE.md` | Live schema/seed-data snapshot — update the `subjects`/`curricula`/`subject_categories` sections whenever a migration changes them. |

**Files #2, #5, #6, #7, #8, #9 are the places a non-academic subject actually gets picked or filtered in the running app.** If you change how Beyond Academic or College Counselling subject picking works, all six need the same change — that repetition (not a shared hook, unfortunately — each form/page has its own local state shape) is exactly why this registry exists. When touching one, grep the others for the same pattern before considering the change done.

---

## 5. Keep these three concepts distinct

It's easy to conflate these three, but they're separate tables serving separate purposes:

| Concept | Table | Purpose |
|---|---|---|
| Program type | `program_types` | Top-level dropdown in session-log forms (`Academics`, `Beyond Academics`, `College Counselling`, `Demo Lesson`, offline-work types, …). Hierarchical via `parent_id`. Drives which fields the session-log form shows. |
| Course type | `course_types` | Billing category (`Academic`, `Beyond Academic`, `College Counselling`, …). Drives which `student_packages` row hours deduct from. |
| Subject category | `subject_categories` | No longer used for **Beyond Academic** or **College Counselling** subjects at all (§3, §3b) — every active row of `type='beyond_academic'` was deactivated 2026-07-02. Academic subjects use `curricula`/`curriculum_groups` instead (§2), not this table; the table itself still exists for legacy/inactive data and a couple of academic-side admin flows. |

A new Beyond Academic or College Counselling "value" (like Podcast, or a third College Counselling offering) usually only needs a plain `subjects` row (§3/§3b) — it does **not** need its own `program_types`/`course_types` rows unless it should be independently billable/reportable as its own top-level category (the path `College Support` → `College Counselling` took on 2026-07-02; see `VERIFIED_DATABASE_STATE.md` seed-data notes for that precedent if this comes up again). Conversely, **an existing top-level `program_types` category's sub-parts can be converted into plain `subjects`** without losing its own top-level program/course type — that's exactly what the 2026-07-09 change did to College Counselling, keeping it billable as one whole course type while letting its parts be picked like any other flat subject list.

---

## 6. Change log (of this hierarchy, not this doc's prose)

- **2026-07-28 (PCs lose catalog-management access)** — Performance coaches can no longer add subjects/curricula to the shared catalog: `/teacher/subjects-library` (`CoachSubjectsManagePage.tsx`, a thin wrapper around file #5) was deleted, along with its nav item and route. File #5 (`SubjectsLibraryContent.tsx`) itself is untouched and still fully functional — it's just admin-only now (`/admin/subjects`). Pure UI/routing change, no schema/RLS change. A PC's self-service `/teacher/subjects` ("My Subjects", file #7/`TeacherSubjectEditor.tsx`) is unaffected — it only assigns already-existing subjects to the coach's own `teacher_subjects` row, it was never a catalog-creation UI. See `README.md` §2.4/§3.4.
- **2026-07-28 (Career Exploration - CC)** — Added **"Career Exploration - CC"** as a plain flat College Counselling `subjects` row (`category = 'college_counselling'`, `category_id = NULL`, active) via `supabase/migrations/20260728000000_add_career_exploration_cc_college_counselling_subject.sql`. No code change — it appears automatically in the College Counselling tab's flat picker (`BeyondAcademicSubjectSelect`, reused per §3b) alongside `College Counselling`/`College Essays`, exactly as §3b's "Rule for a new College Counselling subject" describes. Named with the `- CC` suffix (not plain "Career Exploration") to stay distinct from the pre-existing Beyond Academic subject of that name (id 607, `category = 'beyond_academic'`) — the two are separate, independently billed offerings that would otherwise be indistinguishable in dropdowns/reports.
- **2026-07-21 (Homework style templates hang off this hierarchy)** — the Homework Generator's `style_templates` library became hierarchy-aware: a template can now pin itself to a curriculum / curriculum_group / subject (level carried inside `subject_id`, since SL/HL are separate `subjects` rows — §2) via real FK columns, and the `generate-homework-paper` function resolves the most-specific variant matching a paper's subject/group/curriculum (e.g. "IBDP · English A SL · Section A"), falling back to the generic format. This **consumes** the hierarchy — it does not change how subjects/curricula/groups/levels themselves are structured or picked, so none of the §4 registry files needed changes. If a subject referenced by a template is renamed/deactivated the FK follows it (ON DELETE SET NULL). See `db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md` §"Subject-hierarchy templates" and `supabase/migrations/20260721000000_style_templates_subject_hierarchy.sql`.
- **2026-07-09 (College Counselling moved into the Subjects Library)** — retired College Counselling's `program_types` parent/child shape (top-level id 31 with sub-programs id 32 "College Counselling"/id 33 "College Essays", both now deactivated). Added two plain `subjects` rows instead (`category = 'college_counselling'`, a new distinct value — verified live that the existing non-academic `category` values were too inconsistent to reuse, see §3's caveat). New "College Counselling" tab in `SubjectsLibraryContent.tsx` (`FlatSubjectsTab`, generalized from the old `BeyondAcademicsTab`); new picker branch in `SessionLogFormView.tsx`; new toggle/picker in `TeacherSubjectEditor.tsx` and `AdminTeacherFormPage.tsx`'s teacher-subject-assignment flows; `StudentDetailView.tsx`'s `candidateSubjectsForCourseType()` gained a College Counselling branch. `course_types`/`bundle_pool_settings` untouched — packages/billing still treat College Counselling as one whole course type with one unlabeled bundle pool. See `supabase/migrations/20260709000000_college_counselling_subjects_library.sql` and §3b above.
- **2026-07-03 (AI Incubator)** — Added **"AI Incubator"** as a plain flat Beyond Academic `subjects` row (`category = 'beyond_academic'`, `category_id = NULL`, active) via `supabase/migrations/20260703000001_add_ai_incubator_beyond_academic_subject.sql`. No code change — it appears automatically in `BeyondAcademicSubjectSelect` alongside Book Publishing, Career Exploration, Podcast, etc., exactly as §3's "Rule for a new Beyond Academic subject" describes.
- **2026-07-02 (SL/HL dropdown fix)** — Files #6/#7 (the two session-log forms) were picking an already-assigned academic subject with a single flat dropdown whose *label* baked in the level (`subjectDisplayLabel`, e.g. "Math — Cambridge (9709) — Standard Level" as one option) instead of using `SubjectLevelSelect` like files #8/#9/#10 already did — exactly the inconsistency §2 warns against. Both forms now use `SubjectLevelSelect`, resolving the picked subject id back to the matching `teacher_subjects` row (a teacher_subjects row is 1:1 with a subject within a given curriculum, so this is a safe lookup) rather than storing a subject id directly. `SubjectLevelSelect` gained an optional `required` prop (forwarded to both its Subject and Level `<select>`s) so the hard "must pick a complete subject+level" requirement these forms already had is preserved.
- **2026-07-02 (inactive cleanup)** — Re-confirmed the live active Beyond Academic list (Book Publishing, Entrepreneurship, Passion Projects, Coding and Programming, Finance and literacy, Career Exploration, Creative Writing, Research Writing, Blog Writing, Journalistic Writing, Public Speaking, Podcast) against `/admin/subjects` and audited every file in the §4 registry — all correctly derive from `subjects` with no hardcoded/duplicate list anywhere, so no code changes were needed. Separately, deleted all 110 inactive `subjects` rows and the 1 inactive `program_types` row ("Zoom Invoice"), and wiped `session_logs`, per `supabase/migrations/20260702130000_cleanup_inactive_subjects_program_types_and_session_logs.sql`. See `db/docs/VERIFIED_DATABASE_STATE.md` for exact counts.
- **2026-07-02 (later still)** — Removed `subject_categories`-based grouping for Beyond Academic entirely (the `<optgroup>` from the entry below was itself still a hierarchy). `subjects.category_id` set to `NULL` for every active Beyond Academic subject; the `Passion Projects` and `Career Exploration` `subject_categories` rows deactivated and re-created as plain `subjects` rows instead, so they're directly pickable alongside Book Publishing, Finance and Literacy, Podcast, etc. `BeyondAcademicSubjectSelect` no longer takes a `categories` prop — just a flat `options` list, sorted alphabetically. All five picker files in §4 updated to filter on `subject.category !== 'academic'` instead of `category_id`/`subject_categories` joins. The admin "Subjects Library" → "Beyond Academics" tab (`SubjectsLibraryContent.tsx`) rewritten from a per-section (`SubjectSection`) layout to one flat add/edit/deactivate list — `SubjectSection` was only ever used there and was deleted as dead code once nothing referenced it. See `supabase/migrations/20260702120000_flatten_beyond_academic_no_sections.sql`.
- **2026-07-02** — Added `subject_categories` row `Career Exploration` (`type='beyond_academic'`), alongside the existing `Passion Projects`. Flattened Beyond Academic subject picking from a required two-step "Section → Subject" flow to one flat, optgrouped dropdown (`BeyondAcademicSubjectSelect`) across all five picker files in §4. Removed the "auto-select the only subject without asking" behavior for ungrouped academic curricula (Standard Tests / ACT-SAT-TOEFL-IELTS) in the two session-log forms — the teacher/admin must now explicitly select the subject from the dropdown every time, even when there's only one option. **(Superseded by the entry above — the `<optgroup>` grouping this entry introduced was removed the same day.)**
- **2026-07-02 (earlier)** — Standard Tests (ACT/SAT/TOEFL/IELTS) flattened from four standalone curricula to one `Standard Tests` curriculum with four subjects attached directly via `curriculum_id` (no groups). See `supabase/migrations/20260702050000_standard_tests_flatten_to_direct_subjects.sql`.

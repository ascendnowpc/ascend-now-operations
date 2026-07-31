# Ascend Now — instructions for Claude

## UI copy: keep it minimal

Don't add explanatory or instructional microcopy to the UI unless it's asked for. No "click a row for its sessions", "tap to expand", "no report needed" style hints — a clickable row should show it's clickable through hover/cursor affordances, not a text label. Section headings and labels should be as short as possible ("By subject", not "By subject · click a row for its sessions"). When in doubt, leave the text out; the user consistently prefers a clean, uncluttered interface over descriptive prose.

## Add unit tests with every feature

Every feature or bug fix must ship with unit tests. Run `npm test` (Vitest, `vitest run`) before you consider a change done — a change that leaves the suite red isn't finished.

**The rules:**
1. **New feature → new tests.** Whenever you add a feature, extract its decision-making logic into a pure function (normally under `src/utils/`, or `src/lib/` for infrastructure) and add a `*.test.ts` file next to it. Don't leave the rules buried inside a component where they can't be tested.
2. **Bug fix → regression test.** Write a test that fails on the old behaviour before you fix it, so the bug can't come back silently.
3. **Test the logic, not the framework.** The suite runs in a plain Node environment (`vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]`) — no DOM, no network, no Supabase. Test pure functions: label/formatting helpers, date math, scoring and eligibility rules, parsers, reducers. Do not add React-component rendering tests or tests that hit the live database.
4. **Modules that talk to Supabase or the browser** (`subjectNoteFile.ts`, `homeworkAnswerMedia.ts`, `fetchTeacherPeriodDetail`, the PDF/DOCX builders) are intentionally untested here. When you touch one, pull any pure logic out of it into a testable helper and test that, rather than mocking the whole Supabase client.
5. **Cover the edges, not just the happy path.** Nulls, empty strings, zero, boundary values, and the legacy/back-compat shapes the comments call out are exactly where these helpers are relied on.
6. Keep test names descriptive of the *rule* being enforced (`"No Show 1 pays the teacher nothing"`), not of the function's mechanics — the suite doubles as documentation of the business rules.

## Keep docs in sync with every change

This repo went through a full doc/schema-drift cleanup on 2026-07-01 (README and DB docs were months stale, and two overlapping migration systems had silently diverged from the live database and from each other). Don't let that happen again.

**Whenever you make a change to the database schema:**
1. Add a new timestamped file under `supabase/migrations/` (e.g. `20260715000000_add_x.sql`). Never edit past migration files. `supabase/migrations/` is the single migration system for this project — do not resurrect a second one.
2. Apply it via the Supabase MCP `apply_migration` tool (or `supabase db push`) so it's actually tracked, not just run ad hoc through the SQL editor.
3. Update **`db/docs/VERIFIED_DATABASE_STATE.md`** to reflect the change — this file is the single source of truth for schema and should always match what's live. Re-run the relevant introspection queries (`list_tables`, `pg_policies`, etc. via Supabase MCP) rather than hand-editing from memory.
4. If the change adds/removes a table, update the table list in **`db/README.md`**.
5. If the change is significant enough to affect the "Database Structure" summary in **`README.md`** (new feature area, changed access rules, etc.), update that section too.

**Whenever you make a change to the frontend/app code** (new page, new route, new major feature):
- Update the relevant route table in **`README.md`** section 3 ("Frontend — What's Built") so it keeps matching `src/App.tsx`.
- Update the tech stack table in section 1 if you add/remove a dependency that's user-facing (charting libs, doc-generation libs, etc.).

**Whenever you resolve one of the open items listed in `README.md` §5 (Pending / Open Items)** or `db/docs/VERIFIED_DATABASE_STATE.md`, remove it from that list instead of leaving it to rot as a stale warning.

**Whenever you change anything in the Homework Generator flow** (the `/teacher/homework*` or `/student/homework*` pages and their hooks, the `generate-homework-paper` / `grade-homework-submission` edge functions, the `style_templates` / `content_uploads` / `generated_papers` / `question_bank` / `submissions` / `grades` / `session_insights` tables, the `questions_json` / `answers_json` / `per_question_json` shapes, or the phase plan itself):
- Update **`db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md`** — it's the single source of truth for this feature's design and phase status, and must be treated exactly like README: the status table at the top, the relevant `## Phase N` section, and any scope decision or deferral note all need to keep matching what's actually built. Never leave a phase marked "spec"/"Not started" once it ships, and never leave a "deferred/not decided" note standing once the decision is made.
- Then apply the usual rules above too (this flow touches schema, edge functions, and frontend routes, so `VERIFIED_DATABASE_STATE.md`, `db/README.md`, and `README.md` §2.10 + the route table in §3 all commonly need the same update).

## Why this matters here specifically

- `db/docs/VERIFIED_DATABASE_STATE.md` is what a fresh Claude session (or a human) will trust when reasoning about the schema. If it's stale, the natural failure mode is writing a new migration against a schema that no longer exists — which is exactly how the 63-file mess this repo used to have was created in the first place.
- Do not assume `supabase/migrations/*.sql` reflects live reality just because it's there — always verify against the live project (Supabase MCP `list_tables`/`execute_sql`) before trusting it, and keep it accurate by always applying new migrations through a tracked path (see above) rather than running raw SQL directly against the database.

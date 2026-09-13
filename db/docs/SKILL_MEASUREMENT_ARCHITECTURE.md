# Measuring Motivation, Self-Awareness, Confidence & Discipline — Architecture

**Status: design only. Nothing in this document is built.** This is the plan for how
Ascend Now would measure four non-academic skills — **Motivation, Self-Awareness,
Confidence, Discipline** — from the data the platform already collects, plus a small
amount of new instrumentation. No schema, edge function or UI described here exists yet;
when any phase is actually built, this file moves from "design" to the same
phase-status treatment `HOMEWORK_GENERATOR_ARCHITECTURE.md` gets.

---

## 0. The core problem, stated honestly

These four things are **latent constructs**. Nobody can observe "motivation" — you observe
behaviours that motivation causes, and infer backwards. That inference is only as good as
three things:

1. **Coverage** — do we have enough independent behaviours to triangulate, or are we
   re-reading one teacher's opinion four different ways?
2. **Separation** — can we tell the four apart? A student who submits every homework on
   time might be motivated, or disciplined, or has a strict parent. Those are different
   findings with different interventions.
3. **Attribution** — can we point at the evidence? A score a coach can't defend to a
   parent is worse than no score.

Everything below is organised around those three. The single most important architectural
decision in this document is in §4: **a score is never stored as a number. It is stored as
a reduction over an append-only trail of individually-cited observations, and can always be
expanded back into "here is why."**

### What we can measure well today, and what we can't

| Construct | Measurable from existing data? | Verdict |
|---|---|---|
| **Discipline** | Yes — largely | Attendance, no-shows, submission timing and cadence are already recorded as hard timestamps. Strongest construct out of the gate. |
| **Motivation** | Partly | `independent_work`, homework completion and `engagement_rating` exist, but discretionary effort *between* sessions is invisible (no activity tracking). |
| **Confidence** | Weakly | Needs transcript-level speech data (we only store a pasted Fathom *summary*, not a diarised transcript) and non-attempt vs wrong-attempt separation on homework. |
| **Self-Awareness** | **No — not without new input** | Self-awareness is fundamentally a *calibration* measure: the gap between what a student thinks they know and what they actually know. We never ask the student what they think. Until we do (§3.3), anything we report here is a teacher's impression wearing a number. |

That last row is the single highest-value, lowest-cost build in this whole document: one
confidence slider on the homework attempt page unlocks a genuinely rigorous
self-awareness measure. See §3.3.

---

## 1. Data inventory — everything we collect, and what it can tell us

This is the "what data will be helpful" question answered exhaustively against the live
schema (`VERIFIED_DATABASE_STATE.md`). **M** = Motivation, **S** = Self-Awareness,
**C** = Confidence, **D** = Discipline.

### 1.1 `session_logs` — one row per lesson, filed by the teacher

The densest existing source. 15+ usable fields per session.

| Field | Signal it carries | Feeds | Strength |
|---|---|---|---|
| `session_date` + `created_at` | Cadence, gaps, regularity of attendance | **D**, M | Hard |
| `session_duration_hrs` | Actual time invested; short sessions vs booked length | D | Hard |
| `no_show_type` (`no_show_1/2/plus`) | Reliability. Already severity-tiered by business rules (`src/utils/noShow.ts`) — reuse the tiering, don't invent a second one | **D** | Hard |
| `engagement_rating` (`low/medium/high`) | Teacher's in-the-room read | M, C | Soft — needs teacher calibration, see §5.4 |
| `independent_work[]` (`homework`/`revision`/`self_practice`/`independent_studies`/`none`) | **Discretionary effort between sessions.** `self_practice` and `independent_studies` are unprompted work — the closest thing we have today to intrinsic motivation | **M**, D | Medium |
| `performance_feedback` (free text) | Teacher's narrative. LLM-extractable: persistence, giving up, asking for help, self-correction | M, S, C, D | Soft |
| `flag_for_coach` + `flag_category` + `flag_comments` | Escalation events. `Attendance / Engagement Issue` → D; `Behavioural / Mental Health Issue` → moderator (see §5.5); `Academic Performance Concern` → context | D, M | Hard (event) + Soft (text) |
| `fathom_summary` (the "Fathom Transcript" field) | **The richest and most under-used asset in the system.** Currently a pasted text blob | **all four** | High potential, see §3.1 |
| `video_link` | Pointer to the Fathom recording — the route to real diarised audio | all four | Untapped |
| `topic` | Topic-level mastery vs self-rating pairing | S | Supporting |
| `subject_id` / `curriculum_id` / `program_type_id` | **Essential context, not a signal.** Confidence in Maths ≠ confidence in a Passion Project. Every score must be computable per-subject | context | — |

### 1.2 Homework Generator — `generated_papers` → `submissions` → `grades`

The only place we have the student's *own* unmediated output.

| Field | Signal | Feeds |
|---|---|---|
| `generated_papers.published_at` → `submissions.started_at` | **Latency to start.** Hours between a paper landing and the student opening it. A very strong, very cheap discipline + motivation signal | **D**, M |
| `submissions.started_at` → `submitted_at` | Time-on-task. Also, when combined with activity events (§3.2), whether the work was one panicked sitting or spread over days | D, M |
| Submitted vs never-submitted | Completion rate — the headline motivation/discipline number | **M**, **D** |
| `answers_json` per-question | **Blank vs attempted-and-wrong.** These are completely different: wrong = tried; blank = didn't risk it. Non-attempt rate is the best homework-side confidence proxy we have | **C** |
| Answer length / elaboration on subjective questions | Effort beyond the minimum needed to be "done" | M |
| Answer mode — typed vs `photo` vs `whole_paper_answer` PDF | Working-style preference. Weak signal, useful as context | — |
| `generated_papers.difficulty` (`scaffolded`/`standard`/`stretch`) | **Willingness to take on harder work when offered.** Requires the student to have a choice — today the teacher picks. See §3.4 | **C**, M |
| `grades.per_question_json` (marks, AI feedback, `teacher_override`) | Actual competence — the denominator every confidence and self-awareness measure is read against | S, C |
| `grades.total_marks` / `max_marks` over time | Performance trajectory; a confidence measure is meaningless without it | S, C |
| **Feedback uptake** — does attempt N+1 fix what feedback on attempt N flagged? | Derived, not stored. Requires linking a grade's feedback text to the next paper on the same topic. High-value composite | **S**, **D** |
| `grades.published_at` → next login | Do they even look at their feedback? | M, S |

**Gap:** `generated_papers` has **no `due_at`**. Without a deadline, "late" is undefined and
half the discipline signal on the homework side can't be computed. See §3.4.

### 1.3 `coordinator_logs` (+ `_subjects`, `_package_statuses`) — PC check-ins

Append-only by design, which makes it a **time series**, not a snapshot. That is unusually
valuable: it's the only place where a trained adult's structured judgement is recorded
repeatedly on the same scale over months.

| Field | Signal | Feeds |
|---|---|---|
| `student_engagement_rating` (0-5) | Coach's periodic read — a second, independent rater to the teacher's `engagement_rating` | M, C |
| `parent_engagement_rating`, `parent_involvement_rating`, `parent_belief_rating` | **Moderators, never inputs.** They tell us whether observed compliance is self-driven or parent-driven — which is exactly the intrinsic/extrinsic distinction in §2.1 | moderator |
| `academic_progress_rating`, `transformation_outcomes_rating` | Outcome variables to validate the model against (§6) | validation |
| `primary_goal_option_id` + `ideal_outcome` + `goal_timeline` | The stated goal. Compare against what the *student* says in transcripts — alignment is a real motivation signal, mismatch is a real finding | **M** |
| `biggest_challenge_option_id` | Coach's diagnosis; useful as a label to check the model against | validation |
| `next_action_option_id` | **Follow-through**: was the next action actually done by the following log? | **D** |
| `coordinator_log_subjects.baseline_score` + `baseline_score_date` → `final_outcome_grade` timeline | Objective, dated academic trajectory per subject | outcome |
| `loyalty_retention_rating`, `referral_*`, `coordinator_log_package_statuses` | **Commercial signals. Explicitly excluded from every skill score.** A family's renewal behaviour must never leak into a child's motivation score — see §7 | excluded |

### 1.4 `subject_notes`

Teacher-filed notes and attachments per student/subject. Text body is LLM-extractable the
same way `performance_feedback` is; the *rate* at which a teacher files notes says more
about the teacher than the student, so use content only, never volume.

### 1.5 Packages, scheduling and lifecycle

- `student_packages` / hours consumed → planned vs actual cadence. **D**
- `students.status` (`active`/`paused`/`completed`) + `status_changed_at` → pauses are
  major state changes; a score must not run across a pause as if nothing happened. **D**, M
- `students.birthday` → **age.** A 12-year-old's discipline and a 17-year-old's are not the
  same scale. Age is a mandatory normaliser, not a nice-to-have.
- `students.curriculum`, `graduation_year` → exam-proximity pressure, a confound on
  motivation near exam season.

### 1.6 Auth / platform

`users.is_active` and `auth.users.last_sign_in_at` are all that exist — a single
last-login timestamp, no history. Effectively unusable. See §3.2.

### 1.7 What each construct can draw on today — coverage check

| Source | M | S | C | D |
|---|:--:|:--:|:--:|:--:|
| Session logs — structured fields | ●● | ○ | ● | ●●● |
| Session logs — `performance_feedback` text | ●● | ●● | ●● | ●● |
| Session logs — `fathom_summary` *(as a pasted summary)* | ●● | ●● | ●● | ● |
| **Diarised transcript** *(not collected — §3.1)* | ●●● | ●●● | ●●● | ● |
| Homework timing & completion | ●● | ○ | ● | ●●● |
| Homework answer content & blanks | ●● | ● | ●●● | ● |
| Grades / per-question marks | ○ | ●● | ●● | ○ |
| **Student self-report** *(not collected — §3.3)* | ●● | ●●● | ●●● | ● |
| Coordinator logs | ●● | ● | ● | ●● |
| **Platform activity events** *(not collected — §3.2)* | ●●● | ○ | ○ | ●● |

`●●●` primary · `●●` supporting · `●` weak · `○` none

Read the bold rows: **three of the four strongest columns are things we don't collect yet,
and all of them are cheap.** That is the case for Phase 0.

---

## 2. What each construct actually means here

Definitions first, because the indicator list is only defensible if the definition is.

### 2.1 Motivation — *discretionary effort beyond what is required*

The operative word is **discretionary**. Doing assigned homework is compliance; doing
revision nobody asked for is motivation. So the indicator set weights unprompted behaviour
far above required behaviour:

| Indicator | Computed from | Weight class |
|---|---|---|
| Discretionary work rate | % of sessions with `independent_work` ∈ {`self_practice`, `independent_studies`, `revision`} | Primary |
| Homework completion rate | `submissions.submitted_at` present / papers published | Primary |
| Effort depth | Answer elaboration beyond mark-scheme minimum; optional questions attempted | Primary |
| Between-session activity | Logins / resource opens on non-session days (§3.2) | Primary |
| Initiative in session | Student-raised topics, forward-looking asks ("can we cover X next time") from transcript | Primary |
| Feedback-seeking | Opens published grades; asks follow-up questions on feedback | Supporting |
| Goal ownership | Does the student articulate a goal matching `coordinator_logs.primary_goal` / `ideal_outcome`? | Supporting |
| Teacher & coach engagement ratings | `session_logs.engagement_rating`, `coordinator_logs.student_engagement_rating` | Supporting (calibrated) |

**Intrinsic vs extrinsic split.** Compute motivation **twice**: once raw, and once
conditioned on `parent_involvement_rating` / `parent_engagement_rating`. High compliance +
high parent involvement + low unprompted work = **externally driven** — a materially
different (and more fragile) profile from the same compliance with low parent involvement.
Report it as a two-axis reading, never collapsed into one number. This distinction is the
single most actionable thing the motivation model can produce for a coach.

### 2.2 Self-Awareness — *accuracy of self-assessment*

Definitionally comparative. It needs the student's own claim about themselves next to an
objective measure of the same thing. Indicators, strongest first:

| Indicator | Computed from | Needs |
|---|---|---|
| **Score calibration error** — \|predicted % − actual %\| per paper | Self-predicted score at submit vs `grades.total_marks/max_marks` | §3.3 |
| **Per-question calibration (Brier score)** — confidence rating vs correctness, question by question | Per-question confidence slider vs `per_question_json` | §3.3 |
| **Topic-level calibration** — self-rated-weak topics vs actual per-topic error rate | Self-rated topic confidence vs marks grouped by `question_bank.topic` | §3.3 |
| **Spontaneous misconception naming** — does the student identify their own error before the teacher does? | Transcript extraction | §3.1 |
| **Help-seeking specificity** — "I don't get it" vs "I don't get why step 3 flips the sign" | Transcript extraction; gradeable on a 4-point rubric | §3.1 |
| **Feedback uptake** — does the next attempt address the exact prior feedback? | Grade feedback text → next submission on same topic | Existing data |
| Reflection quality | Periodic written reflection scored against a rubric | §3.3 |

Calibration is the backbone. Note that calibration decomposes cleanly:
**signed** error is *confidence* (§2.3); **absolute** error is *self-awareness*. Same
instrument, two constructs, cleanly separated — which is exactly the "separation" problem
from §0 solved properly rather than by assertion.

### 2.3 Confidence — *willingness to attempt, speak, and be wrong in public*

Must always be read **relative to actual competence**. High confidence with low accuracy is
overconfidence; low confidence with high accuracy is the classic under-confident
high-achiever. Both are findings; a single scalar destroys both.

| Indicator | Computed from | Needs |
|---|---|---|
| **Non-attempt rate** — blank questions as a share of questions the student's demonstrated level says they could have attempted | `answers_json` blanks vs per-topic ability | Existing |
| **Stretch uptake** — takes on `stretch` difficulty when offered the choice | `generated_papers.difficulty` + student choice | §3.4 |
| **Talk-time ratio** — student words / total words per session | Diarised transcript | §3.1 |
| **Turn initiation rate** — turns the student starts vs turns that answer a direct question | Diarised transcript | §3.1 |
| **Hedging density** — "I think", "maybe", "probably wrong", "sorry", trailing-off — per 100 student words | Transcript extraction | §3.1 |
| **Answer assertiveness** — declarative vs question-intoned responses | Transcript extraction | §3.1 |
| **Self-rated confidence level** (the level, not the error) | Confidence slider | §3.3 |
| **Post-setback resilience** — does attempt rate / talk time drop after a bad grade, and for how long? | Existing timeline + above | Derived |

Resilience deserves emphasis: **the recovery curve after a low grade is more diagnostic than
the baseline level.** A student whose participation collapses for three sessions after one
bad mark has a confidence problem that an average would hide entirely.

### 2.4 Discipline — *consistency and follow-through over time*

The only construct where **variance matters more than level**. A student who does 100% of
homework in week 1 and 0% in week 5 scores the same *average* as a steady 50% student and is
a completely different case.

| Indicator | Computed from | Needs |
|---|---|---|
| Attendance reliability | `no_show_type` rate, severity-weighted per `noShow.ts` tiers | Existing |
| Cadence regularity | **Coefficient of variation of inter-session gaps** — not the mean gap | Existing |
| On-time submission rate | `submitted_at` vs `due_at` | §3.4 |
| Procrastination profile | Distribution of submission time relative to deadline; last-minute clustering | §3.4 |
| Start latency | `published_at` → `started_at` | Existing |
| Work distribution | Whether a paper was done across multiple sittings or one crammed session | §3.2 |
| Streak maintenance | Consecutive weeks with ≥1 session and ≥1 submitted paper | Existing |
| Coach action follow-through | Was `next_action` done by the next coordinator log? | Existing |
| Punctuality | Scheduled start vs actual start | §3.4 (not captured at all today) |

---

## 3. New instrumentation required

Five additions, ordered by value-per-unit-effort. Everything in §2 marked "needs" traces
here.

### 3.1 Diarised session transcripts — `session_transcripts`

**Why this is first.** `session_logs.fathom_summary` is a human-pasted *summary*. A summary
has already thrown away everything that makes a transcript valuable for these constructs:
who spoke, how much, in what order, in whose words. Talk-time ratio, turn initiation,
hedging density, spontaneous misconception naming — all four of the strongest
motivation/confidence/self-awareness indicators need the raw turns.

Proposed shape (design only):

```
session_transcripts
  id, session_log_id -> session_logs.id (unique)
  source            'fathom_api' | 'manual_paste' | 'upload'
  fetched_at, duration_seconds
  turns             jsonb  -- [{ speaker_role: 'student'|'teacher'|'unknown',
                          --    speaker_label, start_s, end_s, text }]
  word_counts       jsonb  -- { student, teacher, unknown }
  processing_status 'pending'|'ok'|'failed', processing_error
```

Notes:
- Pull from the **Fathom API** keyed off the existing `video_link`, rather than asking
  teachers to paste more. Teacher effort is already the binding constraint on this platform.
- Speaker→role mapping will not be reliable out of the box (Fathom labels by participant
  name). Needs a resolution step against `session_logs.teacher_id`/`student_id`, with an
  `unknown` bucket that is excluded from ratios rather than guessed.
- **Group/multi-student sessions and shared packages break the 1:1 student assumption.**
  Talk-time ratios are only valid for 1:1 sessions — gate on it explicitly.
- Retention, consent and minors: see §7. This is the highest-sensitivity data in the system
  and should not be built before the consent question is answered.

### 3.2 Platform activity events — `student_activity_events`

Today `auth.users.last_sign_in_at` is one timestamp with no history. Everything about
between-session behaviour is invisible.

```
student_activity_events
  id, student_id -> students.id
  event_type   'login' | 'homework_opened' | 'homework_saved' | 'homework_submitted'
             | 'grade_viewed' | 'feedback_expanded' | 'note_opened' | 'resource_downloaded'
  entity_type, entity_id        -- e.g. ('generated_paper', 42)
  occurred_at, session_key, client
```

Unlocks: between-session engagement (M), whether feedback is ever read (M/S), work spread
across sittings vs crammed (D), and re-engagement after a pause. Deliberately **event
counts and timings only — no page-content logging, no keystroke capture.** Append-only,
with a retention window (§7).

### 3.3 Student self-report — the self-awareness unlock

Three small instruments. Together they turn self-awareness from "not measurable" to the
**best-evidenced** of the four.

1. **Per-question confidence** — a 1-5 slider next to each question on the attempt page
   ("how sure are you?"). Pairs directly against `per_question_json` correctness → Brier
   score. This is one UI control and one jsonb field.
2. **Predicted score at submit** — one question in the submit dialog: "what do you think
   you'll get?" Pairs against `total_marks/max_marks` → calibration error. Signed error
   feeds confidence, absolute error feeds self-awareness.
3. **Periodic reflection** — 4-6 short questions monthly (what went well, what's hardest
   right now, what will you do differently). Scored against a rubric by the LLM extractor,
   and — more valuably — compared against what the teacher independently said that month.

```
student_self_reports
  id, student_id, kind 'question_confidence'|'score_prediction'|'reflection'
  submission_id -> submissions.id (nullable)
  payload jsonb, submitted_at
```

Design constraints that decide whether this works:
- **Never graded, never shown to parents, and said so in the UI.** The moment a student
  believes a prediction affects how they're judged, they game it and the instrument is dead.
- Optional, skippable, ≤10 seconds. A skipped rating is missing data, not a zero.
- Keep the scale fixed forever. Changing a 5-point scale to 7 later invalidates every
  historical comparison.

### 3.4 Homework deadlines and student-chosen difficulty

Two small additions to `generated_papers`:
- **`due_at`** — without it, "on time", "late" and the procrastination profile are all
  undefined. Half the discipline model depends on this one column.
- **Student-selectable stretch work** — an optional extra `stretch` section the student can
  choose to attempt. Turns difficulty from a teacher decision into a *student* decision,
  which is what makes it a confidence and motivation signal at all.

### 3.5 Scheduled sessions

`session_logs` only records sessions that happened (plus no-shows). There is no scheduled
time, so **punctuality, lateness and who-cancelled cannot be computed at all.** A minimal
`scheduled_sessions` table (planned datetime, duration, cancelled_by, cancelled_at,
rescheduled_to) closes the last real gap in the discipline model. Lowest priority of the
five — it touches scheduling workflow, which is a bigger change than the rest.

---

## 4. The pipeline

Five layers. The hard boundary is between layer 2 and layer 3: **extraction produces cited
observations, scoring produces numbers, and the two are never done by the same component.**

```
  L1  EVIDENCE            session_logs · submissions · grades · coordinator_logs
                          subject_notes · packages · students
                          + session_transcripts · activity_events · self_reports  (new)
                                            |
  L2  EXTRACTION          (a) deterministic extractors — pure TS over rows
                          (b) LLM extractors — edge fn, one document at a time,
                              emits typed observations WITH quoted evidence
                                            |
  L3  SIGNAL STORE        skill_signals — append-only, immutable, one row per
                          observation, every row traceable to its source row
                                            |
  L4  SCORING             pure functions: signals -> indicator -> construct
                          versioned weights, time decay, baseline normalisation,
                          data-sufficiency gate
                                            |
  L5  PRESENTATION        coach view · teacher view · student view · parent view
                          each with different granularity and different guardrails
```

### 4.1 L2a — deterministic extractors

Everything computable from structured rows: completion rates, latencies, gap variance,
no-show weighting, blank rates, calibration error, streaks. Pure functions, no I/O.

Per `CLAUDE.md`, these live in `src/utils/skills/` as pure modules with a `*.test.ts`
beside each — `attendanceRegularity.ts`, `homeworkTiming.ts`, `calibration.ts`,
`discretionaryEffort.ts`, `nonAttemptRate.ts`, and so on. Test names state the **rule**
("a paper started 20 minutes before the deadline counts as last-minute"), so the suite
doubles as the specification of the skill model. This is the same discipline `noShow.ts`
and `packageStatus.ts` already follow, and it matters more here: these functions encode
business judgements about children.

### 4.2 L2b — LLM extractors

One edge function per document type — transcript, teacher feedback text, reflection —
following the existing Gemini-based pattern (`generate-homework-paper`,
`grade-homework-submission`). Hard rules:

- **Extractors never emit a score.** They emit typed observations: construct, indicator,
  polarity, strength, and a **verbatim quote plus its location**. Scoring is L4's job and
  L4 is deterministic. An LLM that outputs "motivation: 7/10" is unauditable and
  irreproducible; an LLM that outputs "student proposed working ahead on calculus —
  *'can we do the next chapter before Friday?'* — turn 34" is checkable by a human in
  two seconds.
- **One document per call.** No cross-session reasoning inside the model; trends are L4's
  job. This keeps every observation traceable and keeps prompt size bounded.
- **Fixed taxonomy.** The model picks from an enumerated indicator list (§2), never invents
  labels. Free-text labels make the signal store unaggregatable within a month.
- **Abstention is a valid output.** "No evidence for this construct in this document" must
  be as easy for the model to say as a finding, or it will manufacture findings.
- Prompt and model version are **stamped on every emitted row** so a prompt change is
  visible in the data instead of silently shifting every score.

### 4.3 L3 — the signal store

```
skill_signals
  id
  student_id      -> students.id
  construct       'motivation'|'self_awareness'|'confidence'|'discipline'
  indicator       text   -- fixed vocabulary from §2
  observed_at     timestamptz   -- when the BEHAVIOUR happened, not when we computed it
  value           numeric       -- normalised -1..1 or 0..1 per indicator
  weight          numeric       -- evidence strength
  source_table    text          -- 'session_logs' | 'submissions' | ...
  source_id       text
  subject_id      smallint      -- nullable; subject-specific where it applies
  extractor       text          -- 'deterministic:v3' | 'llm:gemini-x:prompt-v2'
  evidence        jsonb         -- quote + location, or the numbers behind the computation
  created_at
```

Properties that make this the right shape:
- **Append-only and immutable.** Re-running an extractor writes new rows under a new
  `extractor` version; it never mutates history. Scores stay reproducible at any past date.
- **Every row cites a source.** "Why is his discipline down?" expands to actual rows.
- **`observed_at` ≠ `created_at`.** A transcript processed three weeks late is evidence
  about the week it happened. Getting this wrong silently corrupts every trend line.
- Same append-only philosophy `coordinator_logs` already uses, for the same reason:
  history is the product.

### 4.4 L4 — scoring

Pure functions over `skill_signals`. Five rules:

1. **Time decay.** Weight recent evidence higher — an exponential half-life of roughly 6-8
   weeks. Skills change; a term-old observation shouldn't anchor today's reading.
2. **Baseline-relative, not cohort-relative.** With this cohort size, percentile ranking
   against other students is statistically meaningless and pedagogically wrong. The
   comparator is **the student's own first 4-6 weeks**. The headline output is
   *change from baseline*, not level.
3. **Data-sufficiency gate.** Below a minimum of sessions, submissions and distinct
   indicators, the output is **"not enough evidence yet"** — never a low score. Conflating
   "no data" with "bad" is the most common and most damaging failure mode of systems like
   this.
4. **Versioned, config-driven weights.** Indicator weights live in a `skill_model_config`
   table, versioned, not hardcoded. Every computed score stamps the config version it used,
   so re-tuning the rubric doesn't silently rewrite history.
5. **Confidence interval on every score.** Report a band, a trend arrow and an evidence
   count — never a bare point estimate.

Output shape: per student, per construct, optionally per subject —
`{ band, trend, change_from_baseline, evidence_count, measurement_confidence, top_contributing_signals[] }`.

Cached in a `skill_scores` table (recomputed nightly and on new evidence) rather than
computed on the fly, so the coach dashboard stays fast and the number a coach quotes to a
parent on Monday is the same number on Tuesday.

### 4.5 L5 — presentation, per audience

| Audience | Sees | Explicitly does not see |
|---|---|---|
| **Performance Coach** | Full four-construct profile, trends, contributing signals, evidence quotes, intrinsic/extrinsic split, alerts | — |
| **Teacher** | Subject-scoped view for their own subject only, plus practical prompts ("rarely attempts without prompting") | Other subjects, full history, raw scores |
| **Parent** | Narrative summary + trend direction, framed as growth. No numeric score | Numeric scores, transcript quotes, per-session detail |
| **Student** | Their own reflection history and calibration feedback ("you predicted 60%, scored 78% — you're underrating yourself"), framed entirely as a self-improvement tool | Any score labelled "motivation" or "discipline" |
| **Admin** | Cohort aggregates and model health (§6) | Individual evidence quotes |

The student view is deliberately narrow. **Calibration feedback is genuinely useful to a
teenager and improves the thing it measures.** A number labelled "your discipline: 4/10" is
a verdict on their character delivered by software, which is both bad product and bad
practice. Per the repo's UI-copy rule, all of this stays short — a band, an arrow, evidence
on demand, no explanatory prose.

---

## 5. Cross-cutting design decisions

### 5.1 Trend beats level
The business claim is transformation. Every headline number should be a **delta against the
student's own baseline**, with level as secondary. This also sidesteps the small-N problem
and the culture/age normalisation problem in one move.

### 5.2 Trait vs state
One flagged session is a *state*. Scores must be robust to single events — hence time decay
plus a smoothing window, and an `event` channel that surfaces "3 missed sessions in a row"
as an **alert to the coach immediately**, separately from the slow-moving trait score.
Alerts are for acting on; scores are for understanding.

### 5.3 Multi-rater triangulation
Each construct should draw on at least **three independent source families** (student
behaviour, teacher judgement, coach judgement, student self-report). Where raters disagree,
that disagreement is itself the finding — a student the teacher rates high and the coach
rates low is a conversation, not an averaging problem. Surface divergence; don't smooth it
away.

### 5.4 Teacher calibration
`engagement_rating` is a per-teacher scale, not a universal one. Some teachers rate
everyone "high". Before use, **z-score each teacher's ratings within their own
distribution**, and drop any teacher with too few ratings to calibrate. Without this, the
model measures teacher generosity and calls it student motivation. Same treatment for
`coordinator_logs` 0-5 ratings per coach.

### 5.5 Confounds to model explicitly, not ignore
- **Age** (`students.birthday`) — mandatory normaliser.
- **Exam proximity** (`curriculum`, `graduation_year`) — motivation spikes near exams and
  crashes after; don't read seasonal pressure as character change.
- **Mental health / welfare flags** (`flag_category = 'Behavioural / Mental Health Issue'`)
  — a student in difficulty must **not** be scored as undisciplined. This should
  **suppress** scoring and raise a welfare flag instead. Non-negotiable.
- **Paused status** — don't run trends across a `paused` period as if it were engagement
  decline.
- **Teaching quality** — a disengaged student may have a disengaging teacher. Check whether
  low scores cluster by teacher before they cluster by student.
- **Language** — hedging density and talk-time are confounded by English fluency. EAL
  students need a separate baseline or these indicators must be dropped for them.

### 5.6 Cold start
First ~4-6 sessions are **observation only**: signals are collected, no score is shown. This
is also the window that establishes the personal baseline everything else is measured
against.

---

## 6. How we know the model is any good

A scoring system nobody validates is an opinion with a database behind it. Three checks,
all runnable with the data we'd have:

1. **Blind expert agreement.** Have PCs independently rate ~20 well-known students on the
   four constructs, without seeing model output. Compare. Target moderate-or-better
   agreement; systematic disagreement on one construct means that construct's indicator set
   is wrong, and it's usually recoverable by inspecting which signals dominated.
2. **Predictive validity.** Does the week-4 discipline score predict week-12 homework
   completion? Does week-4 motivation predict retention and
   `coordinator_logs.academic_progress_rating` movement? A construct that predicts nothing
   downstream isn't measuring anything.
3. **Known-outcome anchoring.** Check scores against `coordinator_log_subjects`
   baseline → `final_outcome_grade` trajectories and against
   `transformation_outcomes_rating`. **Never** against renewal or referral (§7).

Plus continuous **model-health monitoring**: signal volume per construct, extractor
abstention rate, score-distribution drift after any prompt or weight change, and per-teacher
rating drift. Drift in the output with no change in the input means something broke.

---

## 7. Ethics, privacy and hard limits

These are constraints on the build, not a disclaimer appended to it.

- **Minors' recorded speech is the most sensitive data in the system.** Transcript
  processing (§3.1) needs explicit, informed consent from parent and student, a stated
  retention period, and a documented deletion path. Do not build §3.1 before that policy
  exists.
- **No commercial signal ever enters a skill score.** `loyalty_retention_rating`,
  `referral_*`, renewal status, package value, invoice history — all excluded by
  construction, and the exclusion is asserted in tests. A child's motivation score must
  never be downstream of whether their parents are likely to renew.
- **Welfare overrides measurement.** A behavioural/mental-health flag suppresses scoring
  and raises a human alert. Always.
- **No scores to students as verdicts.** Students see calibration feedback about their own
  predictions, which is actionable and improving. They do not see a "motivation score".
- **Parents see narrative and direction, not numbers.** A number becomes leverage in a
  family argument; a narrative becomes a conversation with the coach.
- **Right to explanation.** Any score shown to any adult must expand into the evidence
  behind it. This is why L3 stores quotes, and why an LLM is never allowed to emit a score
  directly.
- **These are not diagnoses.** Nothing here is clinical or psychometric. It is a structured
  summary of observed behaviour in a tutoring context, and the UI language must never imply
  otherwise.
- **Human in the loop before anything leaves the platform.** A coach reviews before a skill
  reading is used in a parent report or a renewal conversation.

---

## 8. Build phases

Sequenced so each phase is independently useful and the cheap high-value instrumentation
lands before anything is scored.

| Phase | Scope | Unlocks | Status |
|---|---|---|---|
| **0 — Instrumentation** | `due_at` on papers; per-question confidence slider + predicted score (§3.3); `student_activity_events` (§3.2). No scoring, no UI beyond the sliders | Starts accumulating the data every later phase needs. **Do this first — every week of delay is a week of unrecoverable history** | Not started |
| **1 — Deterministic signals** | `src/utils/skills/*` pure extractors + tests; `skill_signals` store; backfill from existing `session_logs`/`submissions`/`grades` | Discipline end-to-end, Motivation partially — from data we already have | Not started |
| **2 — Coach view v1** | L4 scoring (decay, baseline, sufficiency gate, versioned weights) + PC dashboard for Discipline & Motivation only, with evidence expansion | First real product value; validates the pipeline on the two strongest constructs before touching the hard ones | Not started |
| **3 — Transcripts** | `session_transcripts` + Fathom ingestion + LLM extractor (§3.1, §4.2), **gated on the consent policy (§7)** | Confidence, and the transcript half of Self-Awareness | Not started |
| **4 — Self-awareness & confidence** | Calibration scoring over Phase 0's self-reports; reflection instrument; confidence × competence two-axis view | The two constructs that can't be done without new input | Not started |
| **5 — Validation & calibration** | Blind expert agreement, predictive checks, teacher z-scoring, model-health monitoring (§5.4, §6) | Turns the model from plausible to defensible | Not started |
| **6 — Audience views** | Teacher / student / parent views with their respective guardrails (§4.5) | Distribution beyond the coach | Not started |

Phases 0-2 use only existing infrastructure and no LLM. Phase 3 is the first that needs a
policy decision before a line of code.

---

## 9. Open questions for the business

1. **Consent and retention for session recordings/transcripts** — what have families
   actually agreed to, and for how long may we keep it? Blocks Phase 3.
2. **Do parents see these at all?** Narrative-only is the recommendation here; confirm.
3. **Is the self-report data firewalled from grading and from parents?** Must be yes, and
   must be stated in the student UI, or the instrument is worthless.
4. **What is a skill reading allowed to be used for?** Coaching and intervention: yes.
   Renewal conversations, teacher performance reviews, marketing claims: needs an explicit
   decision, and the answer shapes what gets built.
5. **Group and shared-package sessions** (`student_package_members`) — how are talk-time
   ratios handled when two siblings share a session? Simplest answer: don't compute them.
6. **Refusal path** — can a family opt out of skill measurement while staying on the
   platform? There should be a yes here.

---

## 10. Relationship to existing docs

Nothing here is built, so no existing doc changes yet. When phases land, the
`CLAUDE.md` doc-sync rules apply as normal: new tables → `VERIFIED_DATABASE_STATE.md` +
`db/README.md`; new routes → `README.md` §3; new dependencies → `README.md` §1; and this
file gets the phase-status treatment `HOMEWORK_GENERATOR_ARCHITECTURE.md` uses — a status
line at the top that is never left claiming "not started" once something ships.

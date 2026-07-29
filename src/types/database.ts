// =========================================================
// Types mirroring the Supabase database schema.
// Keep these in sync with the SQL migrations as the schema evolves.
// =========================================================

export type UserRole = "teacher" | "student" | "performance_coach" | "admin";

export interface AppUser {
  id: string; // uuid, matches auth.users.id
  username: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string; // e.g. "BATO26-1" (3 letters of first name + 1 of last + enrollment year + sequence)
  first_name: string;
  last_name: string;
  // The former parent/guardian's details, kept as plain fields on the student
  // record now that the separate parent role/account has been removed
  // (2026-07-07 student+parent dashboard merge).
  parent_full_name: string | null;
  parent_phone_number: string | null;
  phone_number: string | null; // the student's own phone
  email: string | null; // the student's login email (creates the username)
  // The "send updates to" address — where invoices/notifications are emailed.
  // May match `email` or be a different address; falls back to `email` when
  // blank (see the enrollment flow / StudentCompleteProfileGate).
  notification_email: string | null;
  curriculum: string | null; // e.g. "IBDP", "IGCSE", "A Levels", "NA", …
  report_card_url: string | null; // optional uploaded report card (report-cards bucket path)
  address: string | null;
  country: string | null;
  user_id: string | null; // links to the student's login account, set once enrolled via the enrollment workflow
  // Added 2026-07-06 for the first-login mandatory profile-completion flow —
  // never required at admin add/renewal time, only at the student's first
  // login (see StudentLayout.tsx).
  graduation_year: number | null;
  birthday: string | null; // ISO date, e.g. "2010-04-20"
  school: string | null;
  created_at: string;
}

export interface PcStudentAssignment {
  id: number;
  student_id: string;
  pc_teacher_id: string;
  assigned_at: string;
  unassigned_at: string | null;
}

// One "Performing Achievements" card on a coach's visual profile — a student
// they helped, the subject, and a before → after score.
export interface PcAchievement {
  student_name: string;
  subject: string; // e.g. "MYP 4 Math"
  institutions: string; // free text, e.g. "World Academy" or "JIS · NYU"
  institution_logo_urls?: string[]; // optional university logos/pictures; one or more shown in place of the institutions text when set
  institution_logo_url?: string | null; // deprecated single-logo form; still read for older rows, coerced into institution_logo_urls
  score_before: string;
  score_after: string;
  score_scale: string; // renders as "/8"; blank = no scale shown
  helped: string[]; // "How we helped" checklist
}

// The small fixed icon set an admin picks from for a card entry.
export type PcProfileIcon =
  | "cap"
  | "book"
  | "certificate"
  | "school"
  | "calendar"
  | "chart"
  | "people"
  | "message"
  | "target"
  | "heart";

// One "icon + heading + short text" card — used for both the Education
// section (a degree, a school) and the Performance Coach timeline (a
// responsibility). A coach can have any number of these per section.
export interface PcCardEntry {
  icon: PcProfileIcon;
  heading: string;
  text: string;
}

// A performance coach's public-facing visual profile (the Canva-style "about
// me" card) — filled at first login, maintained from /teacher/pc-profile, and
// shown to each of their assigned students on the Overview tab. See
// supabase/migrations/20260802000000_pc_profiles.sql.
export interface PcProfile {
  id: number;
  teacher_id: string;
  department: string | null; // small badge above the name, e.g. "Management"
  headline: string; // subtitle under the name; defaults to "Performance Coach"
  photo_url: string | null; // public URL into the `pc-profiles` bucket
  about: string | null; // the "Hi there!…" intro
  achievements: PcAchievement[];
  educator_experience: string[];
  coach_responsibilities: PcCardEntry[];
  education: PcCardEntry[];
  contact_email: string | null;
  contact_phone: string | null;
  is_published: boolean; // true once the first-login setup gate is saved
  created_at: string;
  updated_at: string;
}

export interface StudentPackage {
  id: number;
  student_id: string;
  program_type_id: number | null;
  course_type_id: number; // what this pool actually deducts against (Academic / Beyond Academic / College Counselling) — always the real matching category, unaffected by package_type_id
  package_type_id: number | null; // which bundle (e.g. Foundation Program / All-In-One course_type) this pool is grouped under for display/invoicing; null for an ordinary standalone package
  pool_label: string | null; // distinguishes concurrent pools of the same course_type (e.g. "Discovery Project"); null for the default/general pool
  total_hours_purchased: number;
  hours_used: number; // stored, DB-maintained figure (trigger on session_logs) — the authoritative "used" total; see computeHoursUsed for the equivalent client-side computation
  status: 'active' | 'closed';
  closed_at: string | null;
  is_locked: boolean;
  locked_at: string | null;
  locked_by_user_id: string | null;
  locked_hours_used: number | null;
  created_at: string;
  updated_at: string;
}

// Sticky (teacher, subject) -> pool cache set by a PC resolving an
// ambiguous session log; lets future matching sessions auto-resolve.
export interface SessionLogPoolResolution {
  id: number;
  student_id: string;
  course_type_id: number;
  teacher_id: string;
  subject_id: number | null;
  student_package_id: number;
  resolved_by_user_id: string;
  resolved_at: string;
}

export interface PackageTopup {
  id: number;
  student_package_id: number;
  hours_added: number;
  package_size_label: string;
  note: string | null;
  added_by_user_id: string;
  created_at: string;
}

export interface Invoice {
  id: number;
  student_id: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  generated_by_user_id: string;
  total_hours: number;
  doc_url: string | null;
  status: 'draft' | 'sent' | 'locked';
  locked_at: string | null;
  locked_by_user_id: string | null;
  // When set, the report is visible on the student's dashboard; null = draft,
  // admin/PC only. Set/cleared via the "Publish to student" action.
  published_to_student_at: string | null;
  published_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoicePackage {
  id: number;
  invoice_id: number;
  student_package_id: number;
  created_at: string;
}

export interface InvoiceLineItem {
  id: number;
  invoice_id: number;
  teacher_id: string | null;
  subject_id: number | null;
  curriculum_id: number | null;
  // Which package/pool and course type this line belongs to (added
  // 2026-07-02) — lets a report be sectioned by course type / bundle pool
  // rather than by curriculum. Nullable: legacy line items and lines from
  // sessions with no linked package fall back to a course-type section.
  student_package_id: number | null;
  course_type_id: number | null;
  // The session's program type (added 2026-07-02) — used to label report
  // rows that have no subject (e.g. College Counselling / College Essays)
  // by their program name instead of a bare "—".
  program_type_id: number | null;
  hours: number;
  session_count: number;
  // True when this line's hours came from a No Show + session rather than a
  // completed one (added 2026-07-05) — kept as its own line (never merged
  // with a completed-session line) so reports can show no-show hours/
  // sessions as a distinct breakdown instead of silently folding them in.
  is_no_show: boolean;
  created_at: string;
}

export interface Teacher {
  id: string; // e.g. "RANW26-3" — same mnemonic format as students/admins
  user_id: string | null;
  first_name: string;
  last_name: string | null;
  country: string | null;
  email: string | null;
  phone_number: string | null;
  is_performance_coach: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZoomInvoice {
  id: number;
  teacher_id: string;
  period_month: string; // ISO date, first of month, e.g. "2026-07-01"
  file_url: string;
  uploaded_at: string;
  uploaded_by_user_id: string | null;
  status: 'pending' | 'acknowledged';
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZoomInvoiceWithTeacher extends ZoomInvoice {
  teachers: Pick<Teacher, "id" | "first_name" | "last_name" | "is_performance_coach"> | null;
}

export interface TeacherSubject {
  id: number;
  teacher_id: string;
  subject_id: number;
  curriculum_id: number | null;
  created_at: string;
}

export interface SubjectNote {
  id: number;
  student_id: string;
  teacher_id: string;
  subject_id: number;
  curriculum_id: number | null;
  title: string;
  note_text: string | null;
  file_name: string | null;
  file_url: string | null;
  file_type: string | null;
  created_at: string;
}

export interface ProgramType {
  id: number;
  name: string;
  parent_id: number | null;
  type: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CourseType {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Admin {
  id: number;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Curriculum {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  added_by_teacher_id: string | null;
  acknowledged_by_user_id: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface CurriculumGroup {
  id: number;
  curriculum_id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface SubjectCategory {
  id: number;
  name: string;
  type: 'academic' | 'beyond_academic';
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Subject {
  id: number;
  name: string;
  category: string; // slug kept for backward-compat with session form queries
  category_id: number | null;
  curriculum_group_id: number | null;
  // Direct curriculum link, used only when curriculum_group_id is null — for
  // curricula with no meaningful group breakdown (e.g. ACT, SAT, TOEFL,
  // IELTS). At most one of curriculum_group_id/curriculum_id should be set;
  // both null means "no specific curriculum" (the "Other" bucket).
  curriculum_id: number | null;
  board: string | null;           // 'Cambridge', 'Pearson Edexcel'
  subject_code: string | null;    // '0610', '9709'
  level: string | null;           // 'Standard Level', 'Higher Level', 'Advanced Subsidiary Level', etc.
  sort_order: number;
  is_active: boolean;
  added_by_teacher_id: string | null;
  acknowledged_by_user_id: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export type NoShowType = 'no_show_1' | 'no_show_2' | 'no_show_plus';

// Single-row table — the fixed amount paid to a teacher for a No Show 2 or
// No Show + (No Show 1 pays nothing). Admin-editable so the rate can change
// without a code deploy.
export interface NoShowSettings {
  id: 1;
  payout_amount: number;
  currency: string;
  updated_at: string;
  updated_by_user_id: string | null;
}

// Single-row table — the default session duration (in hours) applied to
// every new session log. Teachers/admins no longer pick a duration
// per-session; this admin-editable default is used instead.
export interface SessionDurationSettings {
  id: 1;
  default_duration_hrs: number;
  updated_at: string;
  updated_by_user_id: string | null;
}

// One row per (bundle, pool) — Foundation Program / All-In-One each fan out
// into several labeled pools at once when purchased (see bundle_pool_settings
// migration). Admin-editable from Admin → Reports → Settings only; never
// shown/editable anywhere else (the enroll form only previews these values).
export interface BundlePoolSetting {
  id: number;
  bundle_name: "Foundation Program" | "All-In-One";
  pool_label: string | null;
  course_type_name: string;
  hours: number;
  sort_order: number;
  updated_at: string;
  updated_by_user_id: string | null;
}

export type EngagementRating = 'low' | 'medium' | 'high';

export type IndependentWorkOption =
  | 'homework'
  | 'revision'
  | 'self_practice'
  | 'independent_studies'
  | 'none';

export interface SessionLog {
  id: number;
  // For Ascend Offline Work, this holds "assigned by" (which teacher
  // assigned the work) instead of a real coordinator/PC — see
  // SessionLogFormView.tsx/SessionLogDetailView.tsx, which relabel the
  // field for that program type rather than using a separate column.
  coordinator_teacher_id: string | null;
  teacher_id: string | null;
  student_id: string | null; // e.g. "BATO26-1"
  student_first_name: string | null; // legacy free-text (pre-migration)
  student_last_name: string | null;  // legacy free-text (pre-migration)
  session_date: string; // ISO date string, e.g. "2026-03-31"
  session_duration_hrs: number | null;
  program_type_id: number | null;
  course_type_id: number | null;
  student_package_id: number | null; // which package generation this session counts against (auto-set by trigger)
  pool_ambiguous: boolean; // true when the student has multiple active pools for this course_type and none has been resolved yet — a PC must pick one
  pool_fallback_used: boolean; // true when no active pool existed for this course_type, so the session was auto-assigned to a different/fresh pool
  subject_id: number | null;
  curriculum_id: number | null;
  topic: string | null;
  video_link: string | null;
  no_show_type: NoShowType | null;
  fathom_summary: string | null;
  fathom_summary_doc_url: string | null;
  invoice_file_url: string | null;
  // Teacher feedback fields (migration 18)
  independent_work: IndependentWorkOption[] | null;
  engagement_rating: EngagementRating | null;
  performance_feedback: string | null;
  flag_for_coach: boolean;
  flag_category: string | null;
  flag_comments: string | null;
  created_at: string;
  updated_at: string;
}

// Teacher with subjects nested (from Supabase join select).
export interface TeacherWithSubjects extends Teacher {
  teacher_subjects?: { id: number; subject_id: number; curriculum_id: number | null }[];
}

export interface MonthlyReport {
  id: number;
  year: number;
  month: number;
  status: 'draft' | 'locked';
  generated_at: string;
  generated_by_user_id: string | null;
  locked_at: string | null;
  locked_by_user_id: string | null;
  period_start: string;
  period_end: string;
  total_hours: number;
  total_sessions: number;
  unique_students: number;
  no_show_count: number;
  created_at: string;
}

export interface MonthlyReportTeacherStat {
  id: number;
  report_id: number;
  teacher_id: string | null;
  teacher_name: string | null;
  sessions: number;
  hours: number;
  // Snapshot at generation time — No Show 2 + No Show + count for this
  // teacher this month, and the payout that count worked out to at the
  // rate in effect then (see no_show_settings).
  no_show_payable_count: number;
  no_show_payout_amount: number;
}

export interface MonthlyReportStudentStat {
  id: number;
  report_id: number;
  student_id: string | null;
  student_name: string | null;
  sessions: number;
  hours: number;
}

export interface MonthlyReportTeacherSubjectStat {
  id: number;
  report_id: number;
  teacher_id: string | null;
  teacher_name: string | null;
  subject_id: number | null;
  subject_name: string | null;
  subject_level: string | null;
  curriculum_id: number | null;
  curriculum_name: string | null;
  program_type_name: string | null;
  sessions: number;
  hours: number;
}

export interface MonthlyReportStudentSubjectStat {
  id: number;
  report_id: number;
  student_id: string | null;
  student_name: string | null;
  subject_id: number | null;
  subject_name: string | null;
  subject_level: string | null;
  curriculum_id: number | null;
  curriculum_name: string | null;
  sessions: number;
  hours: number;
}

export interface MonthlyReportSubjectStat {
  id: number;
  report_id: number;
  subject_id: number | null;
  subject_name: string | null;
  subject_level: string | null;
  curriculum_id: number | null;
  curriculum_name: string | null;
  sessions: number;
  hours: number;
}

// Convenience "joined" shape used in the UI when we need to display
// a session log alongside readable teacher/program names instead of
// raw foreign keys.
export interface SessionLogWithRelations extends SessionLog {
  teacher?: Pick<Teacher, "id" | "first_name" | "last_name"> | null;
  coordinator?: Pick<Teacher, "id" | "first_name" | "last_name"> | null;
  program_type?: Pick<ProgramType, "id" | "name"> | null;
}

export type EnrollmentType = 'new_student' | 'renewal';
export type EnrollmentStatus = 'pending_payment' | 'payment_submitted' | 'confirmed' | 'rejected';

export interface EnrollmentRequest {
  id: string; // uuid
  enrollment_type: EnrollmentType;
  student_id: string | null; // set for renewals; set for new_student only after confirmation
  first_name: string;
  last_name: string;
  parent_full_name: string | null; // the guardian's name, kept for the student record
  // The "send updates to" contact — invoice + payment link + notification
  // recipient. Set to the notification_email the intake form captured, or the
  // student_email when that was left blank (there is no parent login anymore).
  email: string;
  student_email: string | null; // the student's own login email (creates the username)
  notification_email: string | null; // the second "send updates to" address as entered (may be blank)
  curriculum: string | null; // the student's curriculum (IBDP / IGCSE / A Levels / …)
  report_card_url: string | null; // optional uploaded report card (report-cards bucket path)
  phone_number: string | null; // the guardian's phone
  student_phone_number: string | null; // the student's own phone
  address: string | null;
  country: string | null;
  note: string | null;
  // Added 2026-07-06, optional — admin may fill these in if known at
  // enroll/renewal time; copied through to the new students row on confirm.
  // Left null otherwise and picked up later by the student/parent
  // first-login profile-completion flow instead.
  graduation_year: number | null;
  birthday: string | null;
  school: string | null;
  pc_teacher_id: string | null; // required for new_student, unused for renewal
  status: EnrollmentStatus;
  payment_link_token: string; // uuid
  rejection_reason: string | null;
  created_by_user_id: string;
  confirmed_by_user_id: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

// One row per package on the invoice. A single enrollment_requests row (one
// invoice email, one payment link) can carry several of these — added
// 2026-07-25 so an admin can sell/renew more than one package for a student
// in one go instead of submitting a separate request (and separate email)
// per package. Package/pricing fields that used to live directly on
// enrollment_requests moved here.
export interface EnrollmentRequestPackage {
  id: string; // uuid
  enrollment_request_id: string;
  sort_order: number;
  course_type_id: number;
  program_type_id: number | null;
  hours: number;
  package_size_label: string;
  // Set only when course_type_id is a bundle (Foundation Program /
  // All-In-One) AND this line targets one already-existing pool rather than
  // creating the bundle's full set — see the 2026-07-02 bundle-pool-
  // selection migration. bundle_pool_label may itself be null (a bundle's
  // default/unlabeled pool is a valid target); is_bundle_pool_selection is
  // what distinguishes that from "no selection, create every pool".
  is_bundle_pool_selection: boolean;
  bundle_pool_label: string | null;
  // Stamped by review-enrollment-payment on confirm — a multi-package
  // request can create/top-up several different student_packages rows in
  // one confirm, so this lives per line item rather than on the request.
  resulting_student_package_id: number | null;
  is_new_package_generation: boolean | null;
  created_at: string;
}

// One row per uploaded payment screenshot. A parent who paid in more than
// one transaction can upload one file per payment instead of being limited
// to a single screenshot for the whole request (added 2026-07-25).
export interface EnrollmentRequestPaymentProof {
  id: string; // uuid
  enrollment_request_id: string;
  storage_path: string; // payment-proofs bucket path
  uploaded_at: string;
}

// A Performance Coach flags that a specific student's package needs
// renewing (added 2026-07-09). Admin acknowledges it from
// /admin/renewal-requests, and the system auto-marks it "renewed" the
// moment a matching package top-up actually lands via the existing
// /admin/students/enroll → review-enrollment-payment flow — no manual
// "mark as done" step.
export type PackageRenewalStatus = 'pending' | 'acknowledged' | 'renewed';

export interface PackageRenewalRequest {
  id: string; // uuid
  student_id: string;
  course_type_id: number;
  requested_hours: number | null; // PC's suggested hours, optional
  package_size_label: string | null;
  note: string | null;
  requested_by_teacher_id: string; // the requesting PC
  status: PackageRenewalStatus;
  acknowledged_by_user_id: string | null;
  acknowledged_at: string | null;
  resulting_student_package_id: number | null; // set once auto-resolved to 'renewed'
  renewed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Homework Generator (see db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md)
// ---------------------------------------------------------------------------

// How a question is answered/graded, carried on both style_templates and each
// generated question. mcq/true_false/fill_blank auto-grade by exact/fuzzy
// match; the rest are LLM-graded against a mark scheme (Phase 7). true_false
// reuses mcq's options/correct_option shape (exactly 2 options).
export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'structured'
  | 'extended_response'
  | 'essay'
  | 'criterion';

// A reusable exam-format prompt fragment (IBDP Section A, IGCSE Extended, MCQ…).
export interface StyleTemplate {
  id: number;
  code: string;
  name: string;
  board: string | null; // null = generic (not tied to one exam board)
  question_type: QuestionType;
  prompt_fragment: string;
  is_active: boolean;
  created_at: string;
  // Hierarchy targeting (see 20260721000000_style_templates_subject_hierarchy).
  // Templates in the same `section_key` family are variants at different points
  // of the subject hierarchy; the generate-homework-paper edge function resolves
  // the most specific one matching a paper's subject/group/curriculum. A pinned
  // field null = "applies at any value here". `is_selectable=false` variants are
  // resolution-only overrides — they never appear in the teacher's style picker.
  section_key: string;
  curriculum_id: number | null;
  curriculum_group_id: number | null;
  subject_id: number | null;
  is_selectable: boolean;
}

// 'cloned' = created by reusing another paper's questions_json for a
// different student (see cloned_from_paper_id) instead of generating fresh
// content — no session_log/content_upload FK is required for that type.
// 'parsed' = created by uploading an EXISTING paper (a PDF, or a photo/scan of
// one) and having Gemini transcribe its questions verbatim + build the answer
// key, rather than generating new questions. Requires a content_upload_id (the
// uploaded file); has no session log or composition blocks/style templates.
export type ContentSourceType = 'session_log' | 'upload' | 'both' | 'cloned' | 'parsed';

// One question block in a paper-composition request: N questions of one style.
export interface PaperBlock {
  count: number;
  style: string; // style_templates.code (the selectable family the teacher picked)
  // Optional per-block subject targeting. When set, the generate-homework-paper
  // resolver uses THIS subject/curriculum (not the paper-level one) to resolve
  // the exact style-template variant for the block — so a single paper can mix
  // e.g. IBDP English SL Section A + IBDP Maths HL Section A. SL/HL is carried
  // inside subject_id (separate subjects rows). Null/absent = fall back to the
  // paper-level subject_id/curriculum_id.
  subject_id?: number | null;
  curriculum_id?: number | null;
  // Parsed papers only: the section's own instruction text printed under its
  // heading (e.g. "Answer all questions in this section. Marks will be
  // awarded for..."), transcribed verbatim as Markdown — read-only context
  // shown alongside the block's questions, never folded into any of them.
  // Absent for generated papers and for a parsed section with no such text.
  instructions?: string;
  // Parsed papers only: shared stimulus / case study / source text / passage /
  // data set that this section's questions refer to (Markdown), plus any
  // figures inside it — shown ABOVE the questions so the student reads the
  // material first, just like the real paper. Never itself a question. Absent
  // when the section has no such material.
  stimulus?: string;
  stimulus_figures?: QuestionFigure[];
}

export type PaperDifficulty = 'standard' | 'scaffolded' | 'stretch' | 'eal';

// draft → published → in_progress → submitted → graded (Phase 5 state machine).
// A paper stays `draft` through generation; progress/failure is read from
// questions_json (null = not generated yet) and generation_error, not a status
// value — the status check constraint only allows these five.
export type PaperStatus =
  | 'draft'
  | 'published'
  | 'in_progress'
  | 'submitted'
  | 'graded';

// One section within a chapter of an indexed PDF.
export interface OutlineSection {
  title: string;
  page_start: number;
  page_end: number;
}

// One chapter of an indexed PDF, with its sections.
export interface OutlineChapter {
  title: string;
  page_start: number;
  page_end: number;
  sections: OutlineSection[];
}

// The chapter/section tree extracted from a PDF by the index-content-upload
// edge function. Stored on content_uploads.outline.
export interface ContentOutline {
  chapters: OutlineChapter[];
}

// One contiguous slice (chapter or section) of an uploaded PDF.
export interface ContentScopePart {
  label: string; // human-readable, e.g. "Chapter 3 · 3.2 Photosynthesis"
  page_start: number;
  page_end: number;
}

// The slice(s) of an uploaded PDF a paper's questions must be drawn from.
// Null on a paper = use the whole document. `label`/`page_start`/`page_end` are
// a summary/bounding span; `parts` (when present) lists the individual selected
// chapters/sections so a teacher can pick several non-contiguous sections.
// Legacy single-scope papers have no `parts` — treat them as one implicit part.
export interface ContentScope {
  label: string;
  page_start: number;
  page_end: number;
  parts?: ContentScopePart[];
}

// A teacher's uploaded source document (PDF/PPT/DOCX) for a student.
export interface ContentUpload {
  id: number;
  student_id: string;
  uploaded_by_teacher_id: string;
  file_name: string;
  file_url: string; // object path within the private `homework-content` bucket
  file_type: string;
  parsed_text: string | null;
  parse_status: 'pending' | 'processing' | 'completed' | 'failed';
  parse_error: string | null;
  // Chapter/section index (PDF only) + its own async-job lifecycle, separate
  // from parse_status. Null outline until index-content-upload has run.
  outline: ContentOutline | null;
  outline_status: 'pending' | 'processing' | 'completed' | 'failed';
  outline_error: string | null;
  created_at: string;
}

// A single generated question, produced by the Phase 4 generation edge
// function (generate-homework-paper). This is the shape the review/publish
// UI (Phase 5), student attempt UI (Phase 6) and grading service (Phase 7)
// all read off GeneratedPaper.questions_json.
// A figure/diagram (pie chart, graph, geometry, a photographed table image…)
// belonging to a question. For a PARSED paper these are cropped straight out of
// the uploaded page by parse-homework-paper and stored inline as a data: URL, so
// the exact figure from the original paper renders in the attempt/review UI and
// exports without any extra fetch or storage-policy plumbing. `alt` is a short
// description of what the figure shows (accessibility + a fallback if the image
// fails to load).
export interface QuestionFigure {
  data_url: string; // data:image/png;base64,… (self-contained, travels with the paper)
  alt?: string;
}

export interface GeneratedQuestion {
  id: string; // stable within a paper, e.g. "q1"
  block_index: number; // which composition block this came from
  style: string; // style_templates.code
  question_type: QuestionType;
  // The question text. For PARSED papers (parse-homework-paper) this is
  // GitHub-flavored Markdown — tables, bold, and labelled sub-parts (a)/(b)/(c)
  // are preserved so the transcription matches the original paper's layout, not
  // just its words. Generated papers write plain prose here; both render through
  // the same Markdown renderer (plain text is valid Markdown).
  prompt: string;
  marks: number;
  // Figures/diagrams cropped from the source paper (parsed papers only) — shown
  // inline after the prompt in every question view + export.
  figures?: QuestionFigure[];
  // mcq/true_false: the answer options and the correct one (index into
  // options) — true_false always has exactly 2 options, ["True", "False"].
  options?: string[];
  correct_option?: number;
  // fill_blank: the expected answer + acceptable variants for auto-grading.
  expected_answer?: string;
  acceptable_answers?: string[];
  // LLM-graded types: the list of individually creditworthy points.
  mark_scheme?: { point: string; marks: number }[];
  generated: boolean;
}

export interface GeneratedPaperContent {
  questions: GeneratedQuestion[];
  total_marks: number;
  total_questions: number;
  // Parsed papers only: the paper's own front-matter/cover-page instructions
  // (subject/level, date, time allowed, "Instructions to candidates", the
  // max-mark statement) transcribed as Markdown — read-only context shown
  // once at the top of the paper, never an answerable question. Copyright/
  // licensing boilerplate is deliberately excluded by the extraction prompt.
  // Absent for generated papers and for a parsed paper with no such text.
  paper_instructions?: string;
}

export interface GeneratedPaper {
  id: number;
  student_id: string;
  created_by_teacher_id: string;
  subject_id: number | null;
  curriculum_id: number | null;
  content_source_type: ContentSourceType;
  session_log_id: number | null;
  content_upload_id: number | null;
  // Parsed papers only: the ordered list of every uploaded page image when a
  // paper was photographed across several images (one per page). Null for
  // single-file parsed papers (use content_upload_id) and all non-parsed papers;
  // content_upload_id stays set to the first element for back-compat.
  content_upload_ids: number[] | null;
  content_scope: ContentScope | null; // null = whole document
  blocks: PaperBlock[];
  difficulty: PaperDifficulty;
  questions_json: GeneratedPaperContent | null; // populated by generation (Phase 4)
  status: PaperStatus;
  generation_error: string | null;
  published_at: string | null;
  // Set when this paper was created by reusing another paper's questions_json
  // for a different student ("Reuse a paper" in the builder) instead of
  // generating fresh content. References the source paper's id.
  cloned_from_paper_id: number | null;
  created_at: string;
  updated_at: string;
}

// A student's answer to one question. mcq stores the selected option index,
// typed subjective answers store text, and a subjective question can instead
// carry one or more photos and/or PDFs of the student's handwritten/worked
// answer (never AI-graded — see QuestionGrade.graded_by:'manual'); null =
// unanswered. `kind` stays 'photo' regardless of file type — it's the DB/type
// name for "manually graded upload," not a claim every file is an image.
export interface PhotoAnswer {
  kind: 'photo';
  files: { file_url: string; file_name: string }[];
}
export type HomeworkAnswer = string | number | PhotoAnswer | null;
export type AnswersMap = Record<string, HomeworkAnswer>; // keyed by question id

export function isPhotoAnswer(a: HomeworkAnswer): a is PhotoAnswer {
  return typeof a === 'object' && a !== null && a.kind === 'photo';
}

// A single teacher comment pinned to a point on a photo/PDF answer — click
// anywhere to place one, like a margin note on a marked paper. `x`/`y` are
// percentages (0-100) of the rendered image/page, so a pin's position survives
// any display size. `page` is only meaningful for a multi-page whole-paper PDF.
export interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
  page?: number;
  file_index?: number; // which of a per-question answer's several rendered images (photos and/or PDF pages, flattened in file order), if >1
}

// A student's whole-paper worked-solution attachment. `file_url`/`file_name`
// hold the FIRST file (kept flat for back-compat — older submissions and the
// grading edge function's presence check both read these directly); `files`,
// when present, lists every attached file. A student may attach one PDF OR
// several photos OR a mix — each file is rendered page-by-page (PDF) or as an
// image (photo) and flattened into one review surface.
export interface WholePaperAnswer {
  file_url: string;
  file_name: string;
  files?: { file_url: string; file_name: string }[];
}

// Every file in a whole-paper answer, whichever shape it's stored in (legacy
// single-file rows have no `files` array — treat the flat file_url/file_name as
// the one file).
export function wholePaperAnswerFiles(
  wpa: WholePaperAnswer | null,
): { file_url: string; file_name: string }[] {
  if (!wpa) return [];
  if (wpa.files && wpa.files.length > 0) return wpa.files;
  return [{ file_url: wpa.file_url, file_name: wpa.file_name }];
}

// One row per paper (unique paper_id). Immutable once submitted_at is set
// (enforced by the prevent_submission_edit_after_submit DB trigger, non-admin).
export interface Submission {
  id: number;
  paper_id: number;
  student_id: string;
  answers_json: AnswersMap;
  started_at: string;
  submitted_at: string | null;
  // Set when the student attaches a PDF and/or photos covering their whole
  // worked solution instead of answering subjective questions individually —
  // objective (mcq/true_false/fill_blank) questions in answers_json are
  // unaffected either way. Never parsed/split — shown and graded as a whole.
  whole_paper_answer: WholePaperAnswer | null;
}

export interface QuestionGradePoint {
  point: string;
  awarded: number;
  max: number;
}

// The grade for one question inside grades.per_question_json. `awarded` is what
// the auto/AI/teacher grader gave; a teacher override, when present, supersedes
// it for the effective mark (see gradeEffectiveMark in utils/homeworkGrading).
// graded_by:'manual' = a photo answer, always teacher-entered, never AI —
// `annotations` holds the teacher's comment pins on that photo.
export interface QuestionGrade {
  awarded: number;
  max: number;
  graded_by: 'auto' | 'ai' | 'manual';
  feedback?: string;
  per_point?: QuestionGradePoint[]; // AI-graded types: per mark-scheme point
  teacher_override?: { awarded: number; marked_by: string; marked_at: string } | null;
  annotations?: Annotation[]; // manual (photo-answer) grading only
}

export type PerQuestionGrades = Record<string, QuestionGrade>; // keyed by question id

// The grade for submissions.whole_paper_answer — set as a pending placeholder
// (awarded: 0) by grade-homework-submission when a whole-paper PDF is present,
// covering every subjective question's combined marks; the teacher enters
// `awarded` (and may adjust `max`) by hand on the review page. Never AI-graded.
export interface WholePaperGrade {
  awarded: number;
  max: number;
  annotations: Annotation[];
}

// One row per submission (unique submission_id). Written by the Phase 7
// grade-homework-submission edge function (service role); teacher overrides are
// applied client-side by the paper owner (RLS: teacher ALL via paper ownership).
export interface Grade {
  id: number;
  submission_id: number;
  per_question_json: PerQuestionGrades;
  total_marks: number | null;
  max_marks: number | null;
  graded_at: string | null;
  teacher_reviewed_by: string | null;
  teacher_reviewed_at: string | null;
  // Set (as a pending placeholder) when the paper's submission has a
  // whole_paper_answer — see WholePaperGrade.
  whole_paper_grade: WholePaperGrade | null;
  // Set only when the teacher explicitly publishes this grade to the student
  // (see TeacherPaperResults' "Publish grade" action) — null means the grade
  // exists (possibly AI-graded already) but isn't visible to the student yet.
  // Enforced by RLS, not just the UI: "Students can read their own published
  // grades" requires published_at is not null.
  published_at: string | null;
  published_by_teacher_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Coordinator Logs (admin + PC only — see coordinator_logs migration)
// ---------------------------------------------------------------------------

// Discriminates the 6 admin-editable dropdown lists that all share the
// coordinator_log_options table (Admin -> Reports -> Settings).
export type CoordinatorLogListKey =
  | 'primary_goal'
  | 'progress_status'
  | 'biggest_challenge'
  | 'next_action'
  | 'renewal_status'
  | 'referral_status';

export interface CoordinatorLogOption {
  id: number;
  list_key: CoordinatorLogListKey;
  label: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
}

// Fixed 3-value dropdown (given directly, not admin-editable like the 6
// option lists above).
export type PrimaryRelationshipOwner = 'devi' | 'pc_cc' | 'ascend_now_system';

// A periodic PC coaching check-in on a student. Repeating history — one row
// per check-in, same shape as session_logs. All rating fields share one 0-5
// star scale. goal_timeline is month+year only (day always "01" — see the DB
// CHECK constraint).
export interface CoordinatorLog {
  id: number;
  student_id: string;
  teacher_id: string; // the logging PC
  log_date: string; // ISO date

  course_type_ids: number[]; // "type(s) of program/package" — multi-select

  primary_goal_option_id: number | null;
  goal_timeline: string | null; // ISO date, day always "01"
  progress_status_option_id: number | null;
  biggest_challenge_option_id: number | null;
  next_action_option_id: number | null;

  final_outcome_university_placement: string | null;
  final_outcome_project_achievement: string | null;
  evidence_link_profile_building: string | null;

  student_engagement_rating: number | null;
  parent_engagement_rating: number | null;
  academic_progress_rating: number | null;
  referral_potential_rating: number | null;

  renewal_status_option_id: number | null;
  referral_status_option_id: number | null;

  ideal_outcome: string | null;

  // "Engagement" — how involved are the parents?
  parent_involvement_rating: number | null;
  // Did the student actually grow?
  transformation_outcomes_rating: number | null;
  // How committed are they?
  loyalty_retention_rating: number | null;
  // 5 = referred 2+ families or actively promotes; 3 = referred once/positive
  // word of mouth; 1 = no referrals.
  referral_advocacy_rating: number | null;
  // How strongly does this parent believe in Ascend Now? 5 = fully trusts/
  // advocates/defends; 3 = sees value but still evaluating; 1 = skeptical/unclear.
  parent_belief_rating: number | null;

  primary_relationship_owner: PrimaryRelationshipOwner | null;

  // true when filed automatically by the per-package renewal automation
  // (sync_coordinator_log_for_student); false for a log a PC/admin filed via the
  // form. Used to derive the first *manual* PC log date per student.
  is_automated: boolean;

  created_at: string;
  updated_at: string;
}

export type RenewalStatus = 'not_due' | 'upcoming' | 'in_discussion' | 'renewed' | 'not_renewing';

// One package/pool's renewal status, snapshotted onto a coordinator log. This
// is the log's automatic "Renewal" section: one row per package. Populated by
// the DB at log-insert time — never entered by a PC/admin. When a package's
// status changes, the system files a *new* coordinator log (carrying
// everything else forward, dated today), so the coordinator-log history is
// itself the dated record of what changed when.
export interface CoordinatorLogPackageStatus {
  id: number;
  coordinator_log_id: number;
  student_package_id: number | null;
  course_type_id: number | null;
  package_type_id: number | null; // the bundle (Foundation Program / All-In-One) this pool belongs to, if any
  pool_label: string | null;
  renewal_status: RenewalStatus;
  renewal_timing: string | null; // ISO date (month), when it crossed 75% — the timing for this package's renewal
  sort_order: number;
  created_at: string;
}

// One subject added to a Coordinator Log, with its baseline score and (once
// known) final-outcome grade improvement — the user's "pc adds a subject,
// puts the baseline score and final outcome also."
export interface CoordinatorLogSubject {
  id: number;
  coordinator_log_id: number;
  subject_id: number;
  curriculum_id: number | null;
  baseline_score: string | null;
  // The date the baseline score was recorded/measured (optional; academic only).
  baseline_score_date: string | null;
  final_outcome_grade: string | null;
  sort_order: number;
  created_at: string;
}

// Convenience "joined" shape for list/detail views.
export interface CoordinatorLogWithRelations extends CoordinatorLog {
  student?: Pick<Student, "id" | "first_name" | "last_name"> | null;
  teacher?: Pick<Teacher, "id" | "first_name" | "last_name"> | null;
  course_types?: Pick<CourseType, "id" | "name">[] | null;
  subjects?: CoordinatorLogSubject[];
}

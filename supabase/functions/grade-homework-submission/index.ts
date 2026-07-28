// Supabase Edge Function: grade-homework-submission
// Homework Generator grading service (Phase 7).
//
// Request body: { submission_id }
//
// Auto-grades MCQ/fill-blank by exact/normalized match against the answer stored
// in questions_json, LLM-grades the mark-scheme question types against their
// individual gradeable points via the Gemini API, writes the aggregate to the
// `grades` row (one per submission), and flips generated_papers.status to
// 'graded'.
//
// Why service_role: a student owns their `submissions` row but has no write
// access to `grades` or `generated_papers` under RLS — grading is a privileged
// server action they merely trigger on submit. The caller's JWT is still checked
// so only the owning student / owning teacher / performance coach / admin can
// grade a given submission.
//
// AI grades are never final on their own: the teacher-override path (Phase 5/7
// review page) is where a human confirms or adjusts them. If Gemini is
// unavailable, subjective questions come back 0 + "pending teacher review" and
// the response carries ai_incomplete: true — objective marks are still written
// and the teacher finalizes the rest.
//
// MANUAL GRADING (2026-07-14): a subjective question answered with a photo, or
// a submission with a whole-paper PDF attached (submissions.whole_paper_answer,
// covering every subjective question at once), is NEVER sent to Gemini — those
// always come back as a pending placeholder (awarded 0, graded_by:'manual' /
// whole_paper_grade) for the teacher to mark and annotate by hand on the
// review page. A re-grade preserves an already-entered manual mark instead of
// resetting it, since manual marks are never AI output to begin with.
//
// Required secret for subjective grading: GEMINI_API_KEY (optional GEMINI_MODEL).
// Deploy: supabase functions deploy grade-homework-submission

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

// Reads every configured Gemini API key: the required GEMINI_API_KEY plus
// optional GEMINI_API_KEY_2 / _3 / ... fallbacks (capped at 8). Each key is
// expected to belong to a separate Google Cloud project so it carries its own
// independent free-tier quota. (Mirrors generate-homework-paper's
// getGeminiKeys / index-content-upload's getGeminiKeys.)
function getGeminiKeys(): string[] {
  const keys: string[] = [];
  const primary = Deno.env.get("GEMINI_API_KEY");
  if (primary) keys.push(primary);
  for (let i = 2; i <= 8; i++) {
    const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (k) keys.push(k);
  }
  return keys;
}

type QuestionType =
  | "mcq"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "structured"
  | "extended_response"
  | "essay"
  | "criterion";

interface GeneratedQuestion {
  id: string;
  question_type: QuestionType;
  prompt: string;
  marks: number;
  options?: string[];
  correct_option?: number;
  expected_answer?: string;
  acceptable_answers?: string[];
  mark_scheme?: { point: string; marks: number }[];
}

interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
  page?: number;
  file_index?: number;
}

interface QuestionGrade {
  awarded: number;
  max: number;
  graded_by: "auto" | "ai" | "manual";
  feedback?: string;
  per_point?: { point: string; awarded: number; max: number }[];
  teacher_override?: { awarded: number; marked_by: number; marked_at: string } | null;
  annotations?: Annotation[]; // manual (photo-answer) grading only
}

interface WholePaperGrade {
  awarded: number;
  max: number;
  annotations: Annotation[];
}

const SUBJECTIVE_TYPES = new Set<QuestionType>([
  "short_answer",
  "structured",
  "extended_response",
  "essay",
  "criterion",
]);

function isPhotoAnswer(a: unknown): boolean {
  return typeof a === "object" && a !== null && (a as { kind?: unknown }).kind === "photo";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "");
}

// The Gemini free tier caps generate_content at ~20 requests/minute; a 429
// carries a "retry in Ns" hint. Pull it out so we can wait exactly that long.
function parseRetryDelayMs(body: string): number | null {
  const m = body.match(/retry in ([\d.]+)s/i) ?? body.match(/"retryDelay":\s*"([\d.]+)s"/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

// MAX_GEMINI_ATTEMPTS is the number of SWEEPS over the whole key ring (not
// retries on one key) — each sweep tries every configured key once.
const MAX_GEMINI_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 60000;

// Calls Gemini for structured JSON, rotating across every configured API key
// on a transient failure (429/503/500 — a different key/project has an
// independent quota, so rotating is strictly faster than waiting on the same
// one) before falling back to waiting out the last retry hint and sweeping
// the whole key ring again. Thinking is disabled — grading is mechanical and
// it keeps the call fast and the output-token budget for JSON.
async function callGemini(apiKeys: string[], prompt: string, schema: unknown): Promise<unknown> {
  if (apiKeys.length === 0) throw new Error("No Gemini API keys configured");
  let lastError: Error | null = null;

  for (let sweep = 0; sweep < MAX_GEMINI_ATTEMPTS; sweep++) {
    let anyTransient = false;
    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: schema,
              temperature: 0.2,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );
      if (resp.ok) {
        const data = (await resp.json()) as {
          candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
        };
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) {
          lastError = new Error(
            `[key ${i + 1}/${apiKeys.length}] Gemini returned no text (finishReason: ${candidate?.finishReason ?? "?"})`,
          );
          continue;
        }
        try {
          return JSON.parse(text);
        } catch {
          lastError = new Error(`[key ${i + 1}/${apiKeys.length}] Gemini response was not valid JSON`);
          continue;
        }
      }
      const body = await resp.text();
      lastError = new Error(`[key ${i + 1}/${apiKeys.length}] Gemini API error (${resp.status}): ${body.slice(0, 300)}`);
      if (resp.status === 429 || resp.status === 503 || resp.status === 500) anyTransient = true;
    }
    if (!anyTransient) throw lastError ?? new Error("Gemini call failed");
    if (sweep < MAX_GEMINI_ATTEMPTS - 1) {
      const wait = Math.min(
        parseRetryDelayMs(lastError!.message) ?? 5000 * (sweep + 1),
        MAX_RETRY_WAIT_MS,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError ?? new Error("Gemini call failed across all configured API keys");
}

interface SubjectiveGrade {
  per_point: { point: string; awarded: number; max: number }[];
  feedback: string;
}

// LLM-grades ALL mark-scheme questions on the paper in a SINGLE Gemini call,
// keyed by question id. One request (instead of one per question) keeps grading
// well under the free-tier rate limit — grading several questions used to fire
// N sequential calls and the tail got 429'd. Returns a map id -> grade;
// questions the model omits are simply absent (caller marks them pending).
async function gradeSubjectiveBatch(
  apiKeys: string[],
  questions: GeneratedQuestion[],
  answers: Record<string, string | number | null>,
): Promise<Map<string, SubjectiveGrade>> {
  const schema = {
    type: "OBJECT",
    properties: {
      grades: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            points: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { awarded: { type: "INTEGER" } },
                required: ["awarded"],
              },
            },
            feedback: { type: "STRING" },
          },
          required: ["id", "points", "feedback"],
        },
      },
    },
    required: ["grades"],
  };

  const blocks = questions
    .map((q) => {
      const scheme = q.mark_scheme ?? [];
      const ans = typeof answers[q.id] === "string" ? (answers[q.id] as string) : "";
      return [
        `Question id: ${q.id}`,
        `Question: ${q.prompt}`,
        "Mark scheme (award marks per point, up to each point's maximum, based only on what the student's answer demonstrates):",
        ...scheme.map((p, i) => `  Point ${i + 1} (max ${p.marks}): ${p.point}`),
        `Student's answer:\n${ans || "(no answer given)"}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = [
    "You are grading a student's homework answers against their mark schemes. Be fair but rigorous.",
    'Grade EVERY question below. Return a "grades" array with one entry per question, each having its "id", a "points" array with one { awarded } per mark-scheme point IN ORDER (each between 0 and that point\'s max), and a short overall "feedback" string for the student.',
    blocks,
    `Return exactly ${questions.length} grade entries — one for each question id above.`,
  ].join("\n\n");

  const result = (await callGemini(apiKeys, prompt, schema)) as {
    grades?: { id?: string; points?: { awarded?: number }[]; feedback?: string }[];
  };

  const byId = new Map<string, { points?: { awarded?: number }[]; feedback?: string }>();
  for (const g of result.grades ?? []) if (g.id) byId.set(g.id, g);

  const out = new Map<string, SubjectiveGrade>();
  for (const q of questions) {
    const g = byId.get(q.id);
    if (!g) continue; // model omitted this one → caller marks it pending
    const scheme = q.mark_scheme ?? [];
    const per_point = scheme.map((p, i) => {
      const raw = g.points?.[i]?.awarded ?? 0;
      const awarded = Math.max(0, Math.min(p.marks, Math.round(Number(raw) || 0)));
      return { point: p.point, awarded, max: p.marks };
    });
    out.set(q.id, { per_point, feedback: g.feedback ?? "" });
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);

  const callerClient: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

  let submissionId: number | undefined;
  try {
    submissionId = (await req.json()).submission_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!submissionId) return jsonResponse({ error: "submission_id is required" }, 400);

  const service: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: submission, error: subError } = await service
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single();
  if (subError || !submission) return jsonResponse({ error: "Submission not found" }, 404);

  const { data: paper, error: paperError } = await service
    .from("generated_papers")
    .select("*")
    .eq("id", submission.paper_id)
    .single();
  if (paperError || !paper) return jsonResponse({ error: "Paper not found" }, 404);

  // Authorize the caller: admin, the owning student, the owning teacher, or a
  // performance coach — mirroring the RLS on `grades`.
  const [{ data: profile }, { data: teacher }, { data: studentRow }] = await Promise.all([
    service.from("users").select("role").eq("id", user.id).maybeSingle(),
    service.from("teachers").select("id, is_performance_coach").eq("user_id", user.id).maybeSingle(),
    service.from("students").select("id").eq("user_id", user.id).maybeSingle(),
  ]);
  const isAdmin = profile?.role === "admin";
  const isOwningStudent = studentRow?.id === submission.student_id;
  const isOwningTeacher = teacher?.id === paper.created_by_teacher_id;
  const isCoach = teacher?.is_performance_coach === true;
  if (!isAdmin && !isOwningStudent && !isOwningTeacher && !isCoach) {
    return jsonResponse({ error: "Not authorized to grade this submission" }, 403);
  }

  const content = paper.questions_json as { questions: GeneratedQuestion[] } | null;
  if (!content?.questions?.length) return jsonResponse({ error: "Paper has no questions" }, 400);

  const answers = (submission.answers_json ?? {}) as Record<string, unknown>;
  // A whole-paper PDF (submissions.whole_paper_answer) covers every subjective
  // question at once — the student never answered them individually, so none
  // of them get a per-question entry; see whole_paper_grade below instead.
  // Objective (mcq/true_false/fill_blank) questions are unaffected either way.
  const wholePaperAnswer = submission.whole_paper_answer as { file_url: string; file_name: string } | null;
  const apiKeys = getGeminiKeys();
  const perQuestion: Record<string, QuestionGrade> = {};
  let aiIncomplete = false;

  // A re-grade must never clobber marks a teacher already entered by hand —
  // manual (photo-answer) per-question grades and the whole-paper grade are
  // NEVER written by AI, so if one already exists it's carried over as-is
  // (only `max` refreshes, in case the paper's marks changed) rather than
  // reset to a pending 0. This is the one exception to "a re-grade overwrites
  // the grade row" below, which otherwise only applies to auto/AI marks.
  const { data: existingGradeRow } = await service
    .from("grades")
    .select("per_question_json, whole_paper_grade")
    .eq("submission_id", submissionId)
    .maybeSingle();
  const existingPerQuestion = (existingGradeRow?.per_question_json ?? {}) as Record<string, QuestionGrade>;
  const existingWholePaperGrade = (existingGradeRow?.whole_paper_grade ?? null) as WholePaperGrade | null;

  // Grade every mark-scheme (subjective) question NOT covered by a
  // whole-paper PDF and NOT answered with a photo in ONE Gemini call up
  // front, keyed by id — instead of one call per question, which used to hit
  // the free-tier rate limit and leave the tail ungraded.
  const subjectiveQuestions = content.questions.filter((q) => SUBJECTIVE_TYPES.has(q.question_type));
  const aiGradableSubjective = wholePaperAnswer
    ? []
    : subjectiveQuestions.filter((q) => !isPhotoAnswer(answers[q.id]));
  let subjectiveGrades = new Map<string, SubjectiveGrade>();
  if (aiGradableSubjective.length > 0) {
    if (apiKeys.length === 0) {
      aiIncomplete = true; // no key → all subjective come back pending below
    } else {
      try {
        subjectiveGrades = await gradeSubjectiveBatch(
          apiKeys,
          aiGradableSubjective,
          answers as Record<string, string | number | null>,
        );
      } catch (err) {
        // Log the real cause (429, no-text, etc.) — the per-question fallback
        // below only shows the student a generic "pending teacher review".
        console.error("Subjective grading failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  for (const q of content.questions) {
    const max = q.marks;
    const ans = answers[q.id];

    // A whole-paper PDF covers every subjective question at once — those get no
    // per-question entry (see whole_paper_grade). Checked first so a subjective
    // question isn't double-counted below.
    if (wholePaperAnswer && SUBJECTIVE_TYPES.has(q.question_type)) {
      continue;
    }

    // A PHOTO answer is teacher-graded by hand for ANY question type (a student
    // can now photograph a hand-worked answer to an MCQ / fill-blank too, not
    // just a subjective question) — so it must be checked BEFORE the auto-grade
    // branches, which would otherwise mark the photo object as a wrong answer.
    // Carry an already-entered manual mark/annotations across a re-grade.
    if (isPhotoAnswer(ans)) {
      const prior = existingPerQuestion[q.id];
      perQuestion[q.id] =
        prior && prior.graded_by === "manual"
          ? { ...prior, max }
          : { awarded: 0, max, graded_by: "manual", feedback: "Photo answer — awaiting teacher review." };
      continue;
    }

    if (q.question_type === "mcq" || q.question_type === "true_false") {
      const correct = typeof ans === "number" && ans === q.correct_option;
      perQuestion[q.id] = {
        awarded: correct ? max : 0,
        max,
        graded_by: "auto",
        feedback: correct
          ? "Correct."
          : `Incorrect.${
              typeof q.correct_option === "number"
                ? ` Correct answer: ${q.options?.[q.correct_option] ?? "—"}.`
                : ""
            }`,
      };
    } else if (q.question_type === "fill_blank") {
      const accepted = [q.expected_answer, ...(q.acceptable_answers ?? [])]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .map(normalize);
      const correct = accepted.includes(normalize(ans as string | number | null));
      perQuestion[q.id] = {
        awarded: correct ? max : 0,
        max,
        graded_by: "auto",
        feedback: correct ? "Correct." : `Expected: ${q.expected_answer ?? "—"}.`,
      };
    } else {
      // Mark-scheme (LLM-graded) type — read from the batched result.
      const graded = subjectiveGrades.get(q.id);
      if (graded) {
        perQuestion[q.id] = {
          awarded: graded.per_point.reduce((s, p) => s + p.awarded, 0),
          max,
          graded_by: "ai",
          feedback: graded.feedback,
          per_point: graded.per_point,
        };
      } else {
        // No key, batch call failed, or the model omitted this question.
        aiIncomplete = true;
        perQuestion[q.id] = {
          awarded: 0,
          max,
          graded_by: "ai",
          feedback: apiKeys.length > 0
            ? "Automatic grading failed — pending teacher review."
            : "Automatic grading unavailable — pending teacher review.",
          per_point: (q.mark_scheme ?? []).map((p) => ({ point: p.point, awarded: 0, max: p.marks })),
        };
      }
    }
  }

  // Never AI-graded — a teacher marks the whole PDF by hand, out of the
  // combined marks of every subjective question it covers. Preserved as-is
  // across a re-grade once a teacher has touched it (see comment above).
  let wholePaperGrade: WholePaperGrade | null = null;
  if (wholePaperAnswer) {
    wholePaperGrade =
      existingWholePaperGrade ??
      { awarded: 0, max: subjectiveQuestions.reduce((s, q) => s + q.marks, 0), annotations: [] };
  }

  const totalMarks =
    Object.values(perQuestion).reduce((s, g) => s + g.awarded, 0) + (wholePaperGrade?.awarded ?? 0);
  const maxMarks = Object.values(perQuestion).reduce((s, g) => s + g.max, 0) + (wholePaperGrade?.max ?? 0);

  // One grade row per submission; a re-grade overwrites it and clears any prior
  // teacher review AND publish state (the marks are freshly computed and need
  // re-confirming — a student who could already see the old published score
  // must not silently see new marks without the teacher re-publishing).
  const { data: grade, error: gradeError } = await service
    .from("grades")
    .upsert(
      {
        submission_id: submissionId,
        per_question_json: perQuestion,
        whole_paper_grade: wholePaperGrade,
        total_marks: totalMarks,
        max_marks: maxMarks,
        graded_at: new Date().toISOString(),
        teacher_reviewed_by: null,
        teacher_reviewed_at: null,
        published_at: null,
        published_by_teacher_id: null,
      },
      { onConflict: "submission_id" },
    )
    .select()
    .single();
  if (gradeError) return jsonResponse({ error: `Could not save grade: ${gradeError.message}` }, 500);

  const { error: statusError } = await service
    .from("generated_papers")
    .update({ status: "graded", updated_at: new Date().toISOString() })
    .eq("id", paper.id);
  if (statusError) return jsonResponse({ error: `Graded but status update failed: ${statusError.message}` }, 500);

  return jsonResponse({ grade, ai_incomplete: aiIncomplete });
});

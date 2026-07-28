// Supabase Edge Function: generate-homework-paper
// Homework Generator generation service (Phase 4) + scoped regeneration (Phase 5).
//
// Request body (all run as the calling teacher — RLS-enforced, no service_role):
//   { paper_id }                         -> full (re)generation of the whole paper
//   { paper_id, regenerate_block: N }    -> regenerate only composition block N,
//                                           keeping the other blocks' questions
//                                           (and any manual edits) intact
//   { paper_id, regenerate_question: id }-> regenerate a single question by its
//                                           questions_json id (e.g. "q3")
//
// Pulls a draft paper's source content (session log summary and/or an uploaded
// PDF), builds one Gemini prompt per block, validates the structured response,
// and writes the result to generated_papers.questions_json. Every question the
// student has been set before (across their papers) is fed into the prompt as
// an "avoid these" list so regenerating — or building another paper for the
// same student — produces new questions rather than the same ones. question_bank
// is the record that feeds that list; it is written-only (no reuse-on-hit).
//
// Required edge function secret: GEMINI_API_KEY
// Optional fallback keys: GEMINI_API_KEY_2 .. GEMINI_API_KEY_8 (see
// getGeminiKeys) — each should belong to a SEPARATE Google Cloud project so it
// carries its own independent free-tier quota; rotating across them multiplies
// effective throughput instead of every call sharing one 20 RPM pool.
// Optional: GEMINI_MODEL (defaults to "gemini-2.5-flash")
//
// Deploy: supabase functions deploy generate-homework-paper
//
// Deliberate scope decision (see db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md):
// PDF uploads are handed to Gemini via the File API (uploaded once per key,
// referenced by fileUri — see uploadPdfToGemini) — Gemini reads PDFs natively,
// so there is no separate text-extraction step and content_uploads.parsed_text
// is intentionally left null for them. PPT/PPTX/DOCX extraction is still
// unbuilt infra (as Phase 1 already flagged) and fails generation with a clear
// message rather than silently mis-parsing.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// The PDF is sent to Gemini via the File API (raw bytes streamed once), NOT
// inlined as base64 in the JSON body — base64-inlining a multi-MB PDF held the
// raw bytes + a UTF-16 base64 string + the stringified JSON body + the fetch
// encoding all at once and killed the edge worker (status 546). The File API
// keeps only the raw bytes in memory, so the cap is bounded by the worker's
// download headroom rather than Gemini's ~20MB inline-request ceiling.
const MAX_PDF_BYTES = 50 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

// Reads every configured Gemini API key: the required GEMINI_API_KEY plus
// optional GEMINI_API_KEY_2 / _3 / ... fallbacks (capped at 8 — comfortably
// past what anyone will realistically configure). Each key is expected to
// belong to a separate Google Cloud project so it carries its own independent
// free-tier quota.
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

interface PaperBlock {
  count: number;
  style: string;
  // Optional per-block subject targeting — when set, template resolution for
  // this block uses THIS subject/curriculum instead of the paper-level one, so
  // one paper can mix subjects (e.g. English SL + Maths HL). SL/HL is inside
  // subject_id.
  subject_id?: number | null;
  curriculum_id?: number | null;
}

interface StyleTemplate {
  id: number;
  code: string;
  name: string;
  board: string | null;
  question_type: QuestionType;
  prompt_fragment: string;
  // Hierarchy targeting (see 20260721000000_style_templates_subject_hierarchy).
  // A template belongs to a `section_key` family and may pin itself to a point
  // in the subject hierarchy; the resolver picks the most specific match.
  section_key: string;
  curriculum_id: number | null;
  curriculum_group_id: number | null;
  subject_id: number | null;
}

interface GeneratedQuestion {
  id: string;
  block_index: number;
  style: string;
  question_type: QuestionType;
  prompt: string;
  marks: number;
  options?: string[];
  correct_option?: number;
  expected_answer?: string;
  acceptable_answers?: string[];
  mark_scheme?: { point: string; marks: number }[];
  generated: boolean;
}

interface PaperContent {
  questions: GeneratedQuestion[];
  total_questions: number;
  total_marks: number;
}

// The chapter(s)/section(s) of an uploaded PDF the questions must be drawn
// from. Null = use the whole document. `parts` (when present) lists several
// selected slices; legacy single-scope papers have no `parts` and are treated
// as one implicit part.
interface ContentScopePart {
  label: string;
  page_start: number;
  page_end: number;
}
interface ContentScope {
  label: string;
  page_start: number;
  page_end: number;
  parts?: ContentScopePart[];
}

// The subset of the generated_papers row this function reads. The row comes
// back untyped over the wire; casting to this keeps the helpers type-safe.
interface PaperRow {
  id: number;
  student_id: string;
  subject_id: number | null;
  curriculum_id: number | null;
  difficulty: string;
  content_source_type: string;
  session_log_id: number | null;
  content_upload_id: number | null;
  content_scope: ContentScope | null;
  blocks: PaperBlock[] | null;
  status: string;
  questions_json: PaperContent | null;
}

const DIFFICULTY_INSTRUCTIONS: Record<string, string> = {
  standard: "Standard difficulty appropriate for this student's current level.",
  scaffolded:
    "Scaffolded: break multi-step problems into clearly guided sub-parts and use simpler vocabulary than a standard paper.",
  stretch:
    "Stretch: more challenging than standard, multi-step reasoning, extension-level questions.",
  eal: "EAL support: plain, literal language, avoid idioms, define technical terms inline where first used.",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function questionSchema(type: QuestionType) {
  const base = {
    prompt: { type: "STRING" },
    marks: { type: "INTEGER" },
  };
  if (type === "mcq" || type === "true_false") {
    return {
      type: "OBJECT",
      properties: {
        ...base,
        options: { type: "ARRAY", items: { type: "STRING" } },
        correct_option: { type: "INTEGER" },
      },
      required: ["prompt", "marks", "options", "correct_option"],
    };
  }
  if (type === "fill_blank") {
    return {
      type: "OBJECT",
      properties: {
        ...base,
        expected_answer: { type: "STRING" },
        acceptable_answers: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["prompt", "marks", "expected_answer"],
    };
  }
  return {
    type: "OBJECT",
    properties: {
      ...base,
      mark_scheme: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { point: { type: "STRING" }, marks: { type: "INTEGER" } },
          required: ["point", "marks"],
        },
      },
    },
    required: ["prompt", "marks", "mark_scheme"],
  };
}

function blockResponseSchema(type: QuestionType) {
  return {
    type: "OBJECT",
    properties: {
      questions: { type: "ARRAY", items: questionSchema(type) },
    },
    required: ["questions"],
  };
}

interface RawQuestion {
  prompt: string;
  marks: number;
  options?: string[];
  correct_option?: number;
  expected_answer?: string;
  acceptable_answers?: string[];
  mark_scheme?: { point: string; marks: number }[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// Command words that a properly-formed structured/subjective question prompt
// should contain at least one of (or a literal "?"). Catches the "scenario
// with no actual question" bug: Gemini sometimes emits only the setup
// sentence (e.g. "A student pushes a box...") and puts what should have been
// an explicit sub-question ("what happens to the work done if the distance
// doubles, and why?") nowhere but the mark scheme — so the mark scheme grades
// something the student was never asked. This is a cheap, low-false-positive
// proxy for "the prompt is self-contained": every real exam question of this
// type is phrased as a question or instruction, so the absence of any of
// these is a strong signal, not a guess.
// Language-Acquisition subjects (IB Language B / ab initio, IGCSE languages,
// etc.) generate their prompts in the *target language*, so an English-only
// word list wrongly rejects every French/Spanish/German question and fails
// generation outright. The words below are stored accent-stripped and matched
// against an accent-stripped, lowercased prompt (see looksLikeAQuestion), so
// both accented ("Décrivez") and unaccented model output is caught. Matching
// leans deliberately lenient — a false "looks like a question" only skips a
// weak heuristic, whereas a false rejection breaks generation.
const QUESTION_COMMAND_WORDS = [
  // English
  "calculate", "determine", "find", "show that", "state", "define", "explain",
  "describe", "predict", "justify", "outline", "compare", "suggest", "give",
  "identify", "write", "evaluate", "discuss", "derive", "prove", "name",
  "list", "sketch", "draw", "label", "complete", "estimate", "deduce",
  "account for", "comment on", "assess", "what", "why", "how", "which",
  "answer", "choose", "match", "fill in", "true or false",
  // French (infinitive + vous-imperative forms, accent-stripped)
  "expliquez", "expliquer", "decrivez", "decrire", "decris", "repondez",
  "repondre", "justifiez", "justifier", "completez", "completer", "complete",
  "resumez", "resumer", "relevez", "indiquez", "citez", "donnez", "ecrivez",
  "choisissez", "identifiez", "comparez", "analysez", "commentez", "discutez",
  "nommez", "trouvez", "calculez", "montrez", "precisez", "associez", "reliez",
  "cochez", "soulignez", "remplissez", "quel", "quelle", "quels", "quelles",
  "pourquoi", "comment", "combien", "lequel", "vrai ou faux",
  // Spanish
  "explica", "explique", "describe", "describa", "responde", "responda",
  "justifica", "completa", "complete", "resume", "resuma", "indica", "cita",
  "escribe", "elige", "identifica", "compara", "analiza", "comenta", "discute",
  "nombra", "encuentra", "calcula", "muestra", "relaciona", "subraya",
  "rellena", "cual", "cuales", "por que", "como", "cuanto", "cuantos",
  "quien", "verdadero o falso",
  // German
  "erklare", "erklaren", "beschreibe", "beschreiben", "antworte", "begrunde",
  "vervollstandige", "erganze", "nenne", "finde", "berechne", "zeige",
  "vergleiche", "ordne zu", "unterstreiche", "fulle", "welche", "welcher",
  "welches", "warum", "wieso", "wie", "wieviel", "richtig oder falsch",
];

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function looksLikeAQuestion(prompt: string): boolean {
  if (prompt.includes("?")) return true;
  // Normalize away accents so target-language command words match whether or
  // not the model emitted the diacritics.
  const lower = stripDiacritics(prompt.toLowerCase());
  return QUESTION_COMMAND_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

function validateRawQuestion(q: unknown, type: QuestionType): string | null {
  if (!isRecord(q)) return "not an object";
  if (typeof q.prompt !== "string" || !q.prompt.trim()) return "missing prompt";
  if (typeof q.marks !== "number" || q.marks < 1) return "missing/invalid marks";
  if (type === "mcq") {
    if (!Array.isArray(q.options) || q.options.length < 2) return "mcq needs >=2 options";
    if (
      typeof q.correct_option !== "number" ||
      q.correct_option < 0 ||
      q.correct_option >= q.options.length
    )
      return "correct_option out of range";
  } else if (type === "true_false") {
    if (!Array.isArray(q.options) || q.options.length !== 2)
      return "true_false needs exactly 2 options";
    if (
      typeof q.correct_option !== "number" ||
      q.correct_option < 0 ||
      q.correct_option >= q.options.length
    )
      return "correct_option out of range";
  } else if (type === "fill_blank") {
    if (typeof q.expected_answer !== "string" || !q.expected_answer.trim())
      return "fill_blank needs expected_answer";
  } else {
    if (!Array.isArray(q.mark_scheme) || q.mark_scheme.length === 0)
      return "needs a non-empty mark_scheme";
    if (
      q.mark_scheme.some(
        (p) => !isRecord(p) || typeof p.point !== "string" || typeof p.marks !== "number",
      )
    )
      return "mark_scheme entries need point + marks";
    if (!looksLikeAQuestion(q.prompt))
      return "prompt does not contain an explicit question/instruction (e.g. ends in '?' or a command word like 'Calculate'/'Explain'/'Predict') — the mark scheme must not grade something the prompt never asked";
  }
  return null;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

// Uploads a PDF to the Gemini File API and returns its fileUri. Streams the raw
// bytes as the request body (no base64, no giant JSON), so worker memory stays
// flat at ~the file size. Waits for the file to finish PROCESSING before use.
// NOTE: a file uploaded under one API key is scoped to that key's Google Cloud
// project — it is NOT visible to a different key. Every caller of this must
// re-upload when it switches keys rather than reusing a fileUri across keys.
async function uploadPdfToGemini(
  apiKey: string,
  bytes: Uint8Array,
  displayName: string,
): Promise<string> {
  const numBytes = bytes.length;

  // Step 1 — start a resumable upload session.
  const startResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type": "application/pdf",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );
  if (!startResp.ok) {
    const text = await startResp.text();
    throw new Error(`Gemini file upload could not start (${startResp.status}): ${text.slice(0, 300)}`);
  }
  const uploadUrl = startResp.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini did not return a file upload URL");

  // Step 2 — upload the bytes and finalize in one request.
  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(numBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!uploadResp.ok) {
    const text = await uploadResp.text();
    throw new Error(`Gemini file upload failed (${uploadResp.status}): ${text.slice(0, 300)}`);
  }
  const uploaded = (await uploadResp.json()) as {
    file?: { uri?: string; name?: string; state?: string };
  };
  const file = uploaded.file;
  if (!file?.uri || !file?.name) throw new Error("Gemini file upload returned no file uri");

  // Step 3 — wait until the file is ACTIVE (PDFs usually process in seconds).
  let state = file.state;
  let waited = 0;
  while (state === "PROCESSING" && waited < 45000) {
    await new Promise((r) => setTimeout(r, 1500));
    waited += 1500;
    const statResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`,
    );
    if (!statResp.ok) break;
    const statData = (await statResp.json()) as { state?: string };
    state = statData.state;
  }
  if (state === "FAILED") throw new Error("Gemini failed to process the uploaded PDF");
  return file.uri;
}

// Builds a per-key, memoized PDF-part provider: the first call for a given API
// key uploads the PDF under that key's project and caches the in-flight
// promise (so concurrent blocks trying the same key share one upload instead
// of each re-uploading); a later call with a DIFFERENT key (after rotating
// away from a rate-limited one) uploads fresh, since fileUris don't carry
// across keys/projects. Returns a no-op provider when there's no PDF.
function makePdfPartProvider(
  bytes: Uint8Array | null,
  displayName: string,
): (apiKey: string) => Promise<GeminiPart | null> {
  if (!bytes) return () => Promise.resolve(null);
  const cache = new Map<string, Promise<GeminiPart>>();
  return (apiKey: string) => {
    let p = cache.get(apiKey);
    if (!p) {
      p = uploadPdfToGemini(apiKey, bytes, displayName).then(
        (uri): GeminiPart => ({ fileData: { mimeType: "application/pdf", fileUri: uri } }),
      );
      cache.set(apiKey, p);
    }
    return p;
  };
}

// The Gemini free tier caps generate_content at ~20 requests/minute; a 429
// carries a "retry in Ns" hint. Pull it out so we can wait exactly that long.
function parseRetryDelayMs(body: string): number | null {
  const m = body.match(/retry in ([\d.]+)s/i) ?? body.match(/"retryDelay":\s*"([\d.]+)s"/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

// MAX_GEMINI_ATTEMPTS is now the number of SWEEPS over the whole key ring
// (not retries on one key) — each sweep tries every configured key once.
const MAX_GEMINI_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 60000;

// Calls Gemini for one block, rotating across every configured API key on a
// transient failure (429/503/500 — a different key/project has an
// independent quota, so rotating is strictly faster than waiting on the same
// one) before falling back to waiting out the last retry hint and sweeping
// the whole key ring again. A non-transient failure (bad request, disabled
// API, etc.) on every key aborts immediately — waiting won't fix that.
async function callGemini(
  apiKeys: string[],
  textPrompt: string,
  getPdfPart: (apiKey: string) => Promise<GeminiPart | null>,
  schema: unknown,
): Promise<unknown> {
  if (apiKeys.length === 0) throw new Error("No Gemini API keys configured");
  let lastError: Error | null = null;

  for (let sweep = 0; sweep < MAX_GEMINI_ATTEMPTS; sweep++) {
    let anyTransient = false;
    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      try {
        const pdfPart = await getPdfPart(apiKey);
        const parts: GeminiPart[] = [{ text: textPrompt }];
        if (pdfPart) parts.push(pdfPart);
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.7,
              },
            }),
          },
        );
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Gemini API error (${resp.status}): ${body.slice(0, 500)}`);
        }
        const data = (await resp.json()) as {
          candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
        };
        const candidate = data.candidates?.[0];
        if (!candidate) throw new Error("Gemini returned no candidates");
        if (candidate.finishReason && candidate.finishReason !== "STOP") {
          throw new Error(`Gemini stopped early: ${candidate.finishReason}`);
        }
        const text = candidate.content?.parts?.[0]?.text;
        if (!text) throw new Error("Gemini response had no text part");
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("Gemini response was not valid JSON");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = new Error(`[key ${i + 1}/${apiKeys.length}] ${message}`);
        if (/API error \((429|500|503)\)/.test(message)) anyTransient = true;
      }
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

// Generates one block's questions, retrying once (with the validation failure
// fed back into the prompt) if the response doesn't match the requested shape.
async function generateBlock(
  apiKeys: string[],
  basePrompt: string,
  getPdfPart: (apiKey: string) => Promise<GeminiPart | null>,
  type: QuestionType,
  count: number,
): Promise<RawQuestion[]> {
  const schema = blockResponseSchema(type);
  let lastIssue: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = lastIssue
      ? `\n\nYour previous attempt was invalid (${lastIssue}). Return exactly ${count} questions matching the schema.`
      : "";
    const result = await callGemini(apiKeys, basePrompt + retryNote, getPdfPart, schema);
    const questions = isRecord(result) ? result.questions : undefined;
    if (!Array.isArray(questions) || questions.length !== count) {
      lastIssue = `expected ${count} questions, got ${Array.isArray(questions) ? questions.length : "non-array"}`;
      continue;
    }
    const issue = questions.map((q) => validateRawQuestion(q, type)).find((i) => i != null);
    if (issue) {
      lastIssue = issue;
      continue;
    }
    return questions as RawQuestion[];
  }
  throw new Error(`Block generation failed validation: ${lastIssue}`);
}

// Resolves the paper's source content into a text blob (session log) and/or
// raw PDF bytes (upload) that the prompt builder feeds to Gemini. Also
// advances content_uploads.parse_status as a side effect. The PDF is NOT
// uploaded to Gemini here — that happens per-key, lazily, via
// makePdfPartProvider, since a fileUri only exists within the key/project
// that uploaded it and generation may need to rotate keys.
async function resolveSource(
  client: SupabaseClient,
  paper: PaperRow,
): Promise<{ sourceText: string; pdfBytes: Uint8Array | null; pdfFileName: string | null }> {
  let sourceText = "";
  let pdfBytes: Uint8Array | null = null;
  let pdfFileName: string | null = null;

  if (paper.content_source_type === "session_log" || paper.content_source_type === "both") {
    if (!paper.session_log_id) throw new Error("Paper is missing session_log_id");
    const { data: log, error: logError } = await client
      .from("session_logs")
      .select("topic, fathom_summary, performance_feedback")
      .eq("id", paper.session_log_id)
      .single();
    if (logError || !log) throw new Error("Could not load the source session log");
    sourceText += `Session topic: ${log.topic ?? "n/a"}\n\nSession summary:\n${log.fathom_summary ?? "(no summary recorded)"}\n\nTeacher feedback notes:\n${log.performance_feedback ?? "(none)"}\n\n`;
  }

  if (paper.content_source_type === "upload" || paper.content_source_type === "both") {
    if (!paper.content_upload_id) throw new Error("Paper is missing content_upload_id");
    const { data: upload, error: uploadError } = await client
      .from("content_uploads")
      .select("*")
      .eq("id", paper.content_upload_id)
      .single();
    if (uploadError || !upload) throw new Error("Could not load the source upload");

    if (upload.file_type !== "pdf") {
      const msg =
        "PPT/PPTX/DOCX text extraction isn't built yet (Phase 4 scope) — upload a PDF or use a session log as the content source.";
      await client
        .from("content_uploads")
        .update({ parse_status: "failed", parse_error: msg })
        .eq("id", upload.id);
      throw new Error(msg);
    }

    await client.from("content_uploads").update({ parse_status: "processing" }).eq("id", upload.id);

    const { data: fileBlob, error: downloadError } = await client.storage
      .from("homework-content")
      .download(upload.file_url);
    if (downloadError || !fileBlob) {
      const msg = `Could not download uploaded file: ${downloadError?.message ?? "unknown error"}`;
      await client
        .from("content_uploads")
        .update({ parse_status: "failed", parse_error: msg })
        .eq("id", upload.id);
      throw new Error(msg);
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) {
      const msg = `Uploaded PDF is too large (${(bytes.length / 1024 / 1024).toFixed(1)}MB, max ~50MB). Split it into smaller files.`;
      await client
        .from("content_uploads")
        .update({ parse_status: "failed", parse_error: msg })
        .eq("id", upload.id);
      throw new Error(msg);
    }
    pdfBytes = bytes;
    pdfFileName = upload.file_name ?? "upload.pdf";

    // No separate text-extraction step for PDFs — Gemini reads the file
    // directly, so parsed_text is intentionally left null (see file header).
    await client.from("content_uploads").update({ parse_status: "completed" }).eq("id", upload.id);
  }

  if (!sourceText && !pdfBytes) throw new Error("No source content resolved for this paper");
  return { sourceText, pdfBytes, pdfFileName };
}

// Builds the per-block prompt and calls Gemini for one block's raw questions.
// `hasPdf` must reflect whether a PDF part is actually being attached to this
// call (i.e. pdfBytes !== null) — see the content_source_type === "both" note
// below for why this can't be inferred from sourceText alone.
async function generateOneBlock(
  apiKeys: string[],
  tpl: StyleTemplate,
  count: number,
  difficultyNote: string,
  sourceText: string,
  hasPdf: boolean,
  getPdfPart: (apiKey: string) => Promise<GeminiPart | null>,
  scopeNote: string,
  avoidNote: string,
): Promise<RawQuestion[]> {
  // With content_source_type "both", a PDF part is attached to the request
  // AND sourceText is non-empty — but sourceText ? A : B collapsed to "only
  // describe the session log" in that case, never telling Gemini a PDF was
  // even attached (the fileData part was still silently included). Result: a
  // real bug report — the PDF (a full, information-dense document) dominated
  // over the terser session-log summary even though the model was never told
  // to weigh them together, since nothing said the PDF existed at all. Now
  // all three states (source text only / PDF only / both) get an explicit,
  // distinct instruction.
  const sourceInstruction =
    sourceText && hasPdf
      ? `Base the questions on BOTH of the following sources together: the session log summary below, AND the PDF file attached to this request. Draw material from whichever source (or a mix of both) best fits this question style — do not ignore either one just because the other is present.\n\nSession log summary:\n${sourceText}`
      : sourceText
        ? `Base the questions on this source material:\n${sourceText}`
        : "A source PDF is attached — base the questions on it.";

  const promptText = [
    "You are generating a homework paper question block for a tutoring platform.",
    `Question style: ${tpl.name}${tpl.board ? ` (${tpl.board})` : ""}.`,
    tpl.prompt_fragment,
    `Difficulty: ${difficultyNote}`,
    sourceInstruction,
    scopeNote,
    avoidNote,
    "For multiple-choice or true/false options, give ONLY the answer text itself — do NOT prefix an option with a number, letter, or bullet (no \"1.\", \"2)\", \"A.\", \"(a)\", \"- \"). The interface adds its own A/B/C/D labels, so a numbered/lettered option renders as a duplicated label.",
    "Write the wording of every question — the instruction/stem and the mark scheme — in ENGLISH, so a student who is still a beginner in the subject can read what is being asked. Only the specific material being tested may appear in another language: for a language paper, the words, phrases or sentences the student must translate, choose between, or complete (and the answer options) can be in the target language, but the question telling them what to do must be phrased in English.",
    "Every question's prompt text must be fully self-contained: it must explicitly ask everything the mark scheme awards marks for. Do not describe a scenario and then let the mark scheme grade a sub-question (e.g. \"what would happen if X changed\", \"explain why\") that the prompt itself never actually asks — if the mark scheme awards marks for a prediction, explanation, calculation, or definition, the prompt must contain an explicit instruction or question for that (ending in '?' or starting with a command word like 'Calculate', 'Define', 'Explain', 'State', 'Predict'; in a non-English target language, the equivalent command word or a '?' is fine). Multi-part questions should use labelled sub-parts (a), (b), (c) so each mark-scheme point maps to a visible part of the prompt.",
    `Return exactly ${count} questions as JSON matching the provided schema. Do not include any text outside the JSON.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return generateBlock(apiKeys, promptText, getPdfPart, tpl.question_type, count);
}

// Turns a raw Gemini question into a stored GeneratedQuestion. Always uses the
// freshly generated text/answer (no reuse-on-hit) and records it in
// question_bank so future generations for this student can be steered away from
// it. `id` is assigned by the caller so it can preserve ids on a
// single-question regenerate.
async function materializeQuestion(
  client: SupabaseClient,
  paper: PaperRow,
  tpl: StyleTemplate,
  rq: RawQuestion,
  blockIndex: number,
  id: string,
  // The family code the teacher actually picked for this block. `tpl` may be a
  // resolved subject-specific variant (e.g. IBDP_SECTION_A__MATH_AA_SL) whose
  // code isn't in the selectable dropdown — the stored `style` stays the family
  // code so the review UI's per-block header (styleName(block.style)) resolves.
  familyCode: string,
): Promise<GeneratedQuestion> {
  const hashInput = `${tpl.code}|${tpl.question_type}|${String(rq.prompt).trim().toLowerCase().replace(/\s+/g, " ")}`;
  const hash = await sha256Hex(hashInput);

  // Always use the freshly generated question — never serve a stored copy back.
  // Reusing a prior question_bank row on a hash hit made regenerating (or
  // building another paper for the same student) return the same questions
  // over and over, which is the opposite of what a regenerate is for. The bank
  // is now written-only: a record of what's been set, fed back into the prompt
  // as an "avoid these" list (see loadPriorPrompts) so generation varies.
  const answer = {
    options: rq.options?.map(stripOptionPrefix),
    correct_option: rq.correct_option,
    expected_answer: rq.expected_answer,
    acceptable_answers: rq.acceptable_answers ?? [],
    mark_scheme: rq.mark_scheme,
  };
  const promptFinal = rq.prompt;

  // Best-effort record (a duplicate hash just no-ops via the unique index).
  await client.from("question_bank").insert({
    paper_id: paper.id,
    style_template_id: tpl.id,
    subject_id: paper.subject_id,
    curriculum_id: paper.curriculum_id,
    topic: null,
    difficulty: paper.difficulty,
    question_text: rq.prompt,
    question_hash: hash,
    answer_json: answer,
  });

  const q: GeneratedQuestion = {
    id,
    block_index: blockIndex,
    style: familyCode,
    question_type: tpl.question_type,
    prompt: promptFinal,
    marks: rq.marks,
    generated: true,
  };
  if (tpl.question_type === "mcq" || tpl.question_type === "true_false") {
    q.options = answer.options;
    q.correct_option = answer.correct_option;
  } else if (tpl.question_type === "fill_blank") {
    q.expected_answer = answer.expected_answer;
    q.acceptable_answers = answer.acceptable_answers ?? [];
  } else {
    q.mark_scheme = answer.mark_scheme;
    q.marks =
      answer.mark_scheme?.reduce((s: number, p: { marks: number }) => s + p.marks, 0) ?? rq.marks;
  }
  return q;
}

// Strips a leading enumerator the model sometimes bakes into an MCQ option
// ("1. Fourth", "2) Third", "A. Second", "(a) First", "- x") — the UI adds its
// own A/B/C/D label, so an option carrying its own number/letter renders as a
// duplicated "A. 1. Fourth". Requires a delimiter after the token, so a genuine
// answer like "A vacuum" (no dot) or "1984" (no delimiter) is left untouched.
function stripOptionPrefix(s: string): string {
  return s.replace(/^\s*(?:\(?\d{1,2}[.)\]]|\(?[A-Za-z][.)\]]|[-•*])\s+/, "").trim();
}

function withTotals(questions: GeneratedQuestion[]): PaperContent {
  return {
    questions,
    total_questions: questions.length,
    total_marks: questions.reduce((s, q) => s + q.marks, 0),
  };
}

// Every question prompt already set for this student, across all of their
// papers (including this one's current questions) — fed into the generation
// prompt as an "avoid these" list so regenerating, or building another paper
// for the same student, doesn't repeat the same questions. Deduped and capped
// so the prompt stays bounded.
const MAX_AVOID_PROMPTS = 80;
async function loadPriorPrompts(client: SupabaseClient, paper: PaperRow): Promise<string[]> {
  const { data } = await client
    .from("generated_papers")
    .select("questions_json")
    .eq("student_id", paper.student_id);
  if (!data) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of data) {
    const qj = (row as { questions_json: PaperContent | null }).questions_json;
    for (const q of qj?.questions ?? []) {
      const prompt = String(q.prompt ?? "").trim();
      if (!prompt) continue;
      const key = prompt.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(prompt);
    }
  }
  return out.slice(0, MAX_AVOID_PROMPTS);
}

function buildAvoidNote(priorPrompts: string[]): string {
  if (priorPrompts.length === 0) return "";
  const list = priorPrompts.map((p) => `- ${p.slice(0, 200)}`).join("\n");
  return `These questions have already been set for this student — do NOT reuse or lightly reword any of them. Produce genuinely different questions covering different angles:\n${list}`;
}

// The paper's position in the subject hierarchy, used to resolve the most
// specific style template. `groupId` is the picked subject's curriculum group.
interface PaperHierarchy {
  subjectId: number | null;
  groupId: number | null;
  curriculumId: number | null;
}

// Resolves the most-specific active template in the family the teacher picked
// (`familyCode`), given where the paper sits in the subject hierarchy. Walks
// specificity most-specific-first — subject > group > curriculum > generic —
// and never returns anything worse than the picked family head (so a paper
// whose curriculum doesn't match the head still generates, exactly as before
// this feature existed).
async function resolveTemplate(
  client: SupabaseClient,
  familyCode: string,
  hier: PaperHierarchy,
): Promise<StyleTemplate> {
  // Load the picked template — it names the family (section_key) and is the
  // ultimate fallback.
  const { data: headRow, error: headErr } = await client
    .from("style_templates")
    .select("*")
    .eq("code", familyCode)
    .maybeSingle();
  if (headErr) throw new Error(`Could not load style template: ${headErr.message}`);
  if (!headRow) throw new Error(`Unknown style template code: ${familyCode}`);
  const head = headRow as StyleTemplate;

  // Every active variant in the same family.
  const { data: famRows, error: famErr } = await client
    .from("style_templates")
    .select("*")
    .eq("section_key", head.section_key)
    .eq("is_active", true);
  if (famErr) throw new Error(`Could not load style templates: ${famErr.message}`);

  let best: StyleTemplate | null = null;
  let bestScore = -1;
  for (const t of famRows as StyleTemplate[]) {
    // Each variant declares its specificity by which hierarchy field it pins.
    // A pinned field that doesn't match this paper disqualifies the variant.
    let score: number;
    if (t.subject_id != null) {
      if (t.subject_id !== hier.subjectId) continue;
      score = 3;
    } else if (t.curriculum_group_id != null) {
      if (t.curriculum_group_id !== hier.groupId) continue;
      score = 2;
    } else if (t.curriculum_id != null) {
      if (t.curriculum_id !== hier.curriculumId) continue;
      score = 1;
    } else {
      score = 0; // generic family fallback, always eligible
    }
    // Partial unique indexes guarantee one row per specificity slot per family,
    // so a strict > is enough; the id tiebreak is belt-and-suspenders.
    if (score > bestScore || (score === bestScore && best != null && t.id < best.id)) {
      best = t;
      bestScore = score;
    }
  }

  return best ?? head;
}

// Builds a PaperHierarchy for a given subject/curriculum by looking up the
// subject's curriculum group (SL/HL are separate subjects, so subjectId already
// carries the level; the group is one hop up). Used both for the paper-level
// hierarchy and for each block that pins its own subject.
async function hierarchyForSubject(
  client: SupabaseClient,
  subjectId: number | null,
  curriculumId: number | null,
): Promise<PaperHierarchy> {
  let groupId: number | null = null;
  let resolvedCurriculumId = curriculumId;
  if (subjectId != null) {
    const { data: subj } = await client
      .from("subjects")
      .select("curriculum_group_id, curriculum_id")
      .eq("id", subjectId)
      .maybeSingle();
    groupId = (subj?.curriculum_group_id as number | null) ?? null;
    // Grouped subjects carry curriculum only via their group; keep an explicit
    // curriculumId if one was passed, else leave as-is (curriculum-level
    // resolution just won't match, which is fine — group/subject still do).
    if (resolvedCurriculumId == null) {
      resolvedCurriculumId = (subj?.curriculum_id as number | null) ?? null;
    }
  }
  return { subjectId, groupId, curriculumId: resolvedCurriculumId };
}

// Resolves the hierarchy to use for one block: the block's own subject when it
// pins one, otherwise the paper-level hierarchy.
async function hierarchyForBlock(
  client: SupabaseClient,
  block: PaperBlock,
  paperHier: PaperHierarchy,
): Promise<PaperHierarchy> {
  if (block.subject_id == null) return paperHier;
  return hierarchyForSubject(client, block.subject_id, block.curriculum_id ?? paperHier.curriculumId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

  let paperId: number | undefined;
  let regenerateBlock: number | undefined;
  let regenerateQuestion: string | undefined;
  try {
    const body = await req.json();
    paperId = body.paper_id;
    regenerateBlock = body.regenerate_block;
    regenerateQuestion = body.regenerate_question;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!paperId) return jsonResponse({ error: "paper_id is required" }, 400);

  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) return jsonResponse({ error: "GEMINI_API_KEY secret is not configured" }, 500);

  // RLS on generated_papers scopes this to rows the caller is allowed to see
  // (their own papers, or admin/performance-coach). A missing row here means
  // either it doesn't exist or the caller isn't authorized — same 404 either way.
  const { data: paperData, error: paperError } = await callerClient
    .from("generated_papers")
    .select("*")
    .eq("id", paperId)
    .single();
  if (paperError || !paperData) return jsonResponse({ error: "Paper not found" }, 404);
  const paper = paperData as PaperRow;
  if (paper.status !== "draft") {
    // Once published the paper is locked — it may already be in front of the
    // student. Generation/regeneration is only ever allowed while draft.
    return jsonResponse({ error: `Paper status is '${paper.status}', not 'draft'` }, 400);
  }

  // Clear any previous failure so the UI reads this as "generating" while it runs.
  await callerClient.from("generated_papers").update({ generation_error: null }).eq("id", paperId);

  try {
    const blocks: PaperBlock[] = paper.blocks ?? [];
    if (blocks.length === 0) throw new Error("Paper has no composition blocks");

    const difficultyNote =
      DIFFICULTY_INSTRUCTIONS[paper.difficulty] ?? DIFFICULTY_INSTRUCTIONS.standard;
    // Where this paper sits in the subject hierarchy — the fallback for any
    // block that doesn't pin its own subject. Blocks that DO pin a subject
    // resolve against that instead (hierarchyForBlock), so one paper can mix
    // subjects/levels.
    const paperHier = await hierarchyForSubject(callerClient, paper.subject_id, paper.curriculum_id);
    const { sourceText, pdfBytes, pdfFileName } = await resolveSource(callerClient, paper);
    const getPdfPart = makePdfPartProvider(pdfBytes, pdfFileName ?? "upload.pdf");
    const hasPdf = pdfBytes !== null;

    // If the teacher scoped generation to one or more chapters/sections of the
    // uploaded PDF, tell Gemini to only draw on those pages.
    const scope = paper.content_scope;
    let scopeNote = "";
    if (scope && pdfBytes) {
      const parts =
        scope.parts && scope.parts.length
          ? scope.parts
          : [{ label: scope.label, page_start: scope.page_start, page_end: scope.page_end }];
      if (parts.length === 1) {
        const p = parts[0];
        scopeNote = `IMPORTANT: Draw the questions ONLY from "${p.label}" — pages ${p.page_start} to ${p.page_end} of the attached PDF. Ignore every other page and section of the document.`;
      } else {
        const list = parts
          .map((p) => `- "${p.label}": pages ${p.page_start} to ${p.page_end}`)
          .join("\n");
        scopeNote = `IMPORTANT: Draw the questions ONLY from these parts of the attached PDF, and spread the questions across them. Ignore every other page/section:\n${list}`;
      }
    }

    // Questions already set for this student — passed to every block's prompt
    // so generation doesn't repeat them (see loadPriorPrompts / buildAvoidNote).
    const avoidNote = buildAvoidNote(await loadPriorPrompts(callerClient, paper));

    let content: PaperContent;

    if (regenerateQuestion != null) {
      // --- Regenerate one question, keeping everything else ---
      const existing = paper.questions_json as PaperContent | null;
      if (!existing) throw new Error("Paper has no generated questions to regenerate from");
      const target = existing.questions.find((q) => q.id === regenerateQuestion);
      if (!target) throw new Error(`Question ${regenerateQuestion} not found on this paper`);
      const block = blocks[target.block_index];
      if (!block) throw new Error("Question refers to a block that no longer exists");

      const tpl = await resolveTemplate(
        callerClient,
        block.style,
        await hierarchyForBlock(callerClient, block, paperHier),
      );
      const raw = await generateOneBlock(
        apiKeys,
        tpl,
        1,
        difficultyNote,
        sourceText,
        hasPdf,
        getPdfPart,
        scopeNote,
        avoidNote,
      );
      const newQ = await materializeQuestion(
        callerClient,
        paper,
        tpl,
        raw[0],
        target.block_index,
        target.id,
        block.style,
      );
      const questions = existing.questions.map((q) => (q.id === target.id ? newQ : q));
      content = withTotals(questions);
    } else if (regenerateBlock != null) {
      // --- Regenerate one block, keeping the other blocks' questions ---
      const existing = paper.questions_json as PaperContent | null;
      if (!existing) throw new Error("Paper has no generated questions to regenerate from");
      const block = blocks[regenerateBlock];
      if (!block) throw new Error(`Block ${regenerateBlock} does not exist on this paper`);

      const tpl = await resolveTemplate(
        callerClient,
        block.style,
        await hierarchyForBlock(callerClient, block, paperHier),
      );
      const raw = await generateOneBlock(
        apiKeys,
        tpl,
        block.count,
        difficultyNote,
        sourceText,
        hasPdf,
        getPdfPart,
        scopeNote,
        avoidNote,
      );
      const regenerated: GeneratedQuestion[] = [];
      for (let i = 0; i < raw.length; i++) {
        regenerated.push(
          await materializeQuestion(
            callerClient,
            paper,
            tpl,
            raw[i],
            regenerateBlock,
            "tmp",
            block.style,
          ),
        );
      }

      // Rebuild in block order, swapping in the regenerated block, then renumber.
      const questions: GeneratedQuestion[] = [];
      for (let bi = 0; bi < blocks.length; bi++) {
        if (bi === regenerateBlock) questions.push(...regenerated);
        else questions.push(...existing.questions.filter((q) => q.block_index === bi));
      }
      questions.forEach((q, i) => (q.id = `q${i + 1}`));
      content = withTotals(questions);
    } else {
      // --- Full generation of the whole paper ---
      // Each block resolves independently to the most-specific template for this
      // paper's subject, so different blocks can land on different variants.
      const blockResults = await Promise.all(
        blocks.map(async (block, blockIndex) => {
          const tpl = await resolveTemplate(
            callerClient,
            block.style,
            await hierarchyForBlock(callerClient, block, paperHier),
          );
          const raw = await generateOneBlock(
            apiKeys,
            tpl,
            block.count,
            difficultyNote,
            sourceText,
            hasPdf,
            getPdfPart,
            scopeNote,
            avoidNote,
          );
          return { blockIndex, tpl, familyCode: block.style, raw };
        }),
      );

      const questions: GeneratedQuestion[] = [];
      let n = 0;
      for (const { blockIndex, tpl, familyCode, raw } of blockResults) {
        for (const rq of raw) {
          n += 1;
          questions.push(
            await materializeQuestion(callerClient, paper, tpl, rq, blockIndex, `q${n}`, familyCode),
          );
        }
      }
      content = withTotals(questions);
    }

    const { data: updated, error: updateError } = await callerClient
      .from("generated_papers")
      .update({
        questions_json: content,
        generation_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paperId)
      .select()
      .single();
    if (updateError) throw new Error(`Generated but could not save paper: ${updateError.message}`);

    return jsonResponse({ paper: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callerClient
      .from("generated_papers")
      .update({ generation_error: message })
      .eq("id", paperId);
    return jsonResponse({ error: message }, 500);
  }
});

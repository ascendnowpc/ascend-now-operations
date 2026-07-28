// Supabase Edge Function: parse-homework-paper
// Homework Generator — "parse an existing paper" flow.
//
// Instead of generating fresh questions (that's generate-homework-paper), this
// reads an EXISTING paper a teacher uploaded — a PDF of a past paper, or a photo
// / scan of one — and TRANSCRIBES the questions verbatim into the same
// questions_json shape the rest of the feature uses, and builds the answer key
// (MCQ correct option, fill-blank expected answer, or a mark scheme) for each so
// the paper can still be published, attempted, and AI-graded. No new questions
// are invented — the questions are the paper's own.
//
// FORMAT PRESERVATION: `prompt` is transcribed as GitHub-Flavored Markdown (so
// a table on the page becomes a real Markdown table, not run-together text),
// and any genuine visual a question contains (chart/diagram/graph/picture) is
// cropped as an exact image straight out of the source page and attached as
// that question's `figures` — see EXTRACTION_PROMPT / cropFigureFromImage.
//
// NON-QUESTION CONTEXT: the paper's own front matter (subject/level, date,
// time allowed, "Instructions to candidates", max marks) is captured once as
// PaperContent.paper_instructions; each section's own instruction text (e.g.
// "Answer all questions in this section...") as PaperBlock.instructions; any
// shared stimulus / case study / source material / passage / data set that a
// group of questions refers to as PaperBlock.stimulus (+ stimulus_figures),
// shown above those questions; and a per-question topic label as the first
// line of that question's own prompt. None of this is ever turned into an
// answerable question — a parsed paper reads like the real thing (material
// first, then the questions on it). See EXTRACTION_PROMPT.
//
// Request body (runs as the calling teacher — RLS-enforced, no service_role):
//   { paper_id }   -> parse (or re-parse) the paper's uploaded file(s)
//
// The paper must be content_source_type = 'parsed', status = 'draft', sourced
// from an uploaded PDF or image in the homework-content bucket — content_upload_id
// for a single file, or content_upload_ids (ordered) when a paper was
// photographed across several images (each image becomes one Gemini file part).
// The client rasterizes a multi-page PDF into one page-image upload per page
// before calling this function (see useGeneratedPapers.parseExistingPaper) so
// every page is a decodable raster image here — figure cropping needs real
// pixels to crop from, which a PDF byte stream doesn't give this Deno runtime.
// A raw 'pdf' upload is still accepted as a fallback (older rows / a client
// that couldn't rasterize): transcription still works via Gemini's File API,
// it just can't crop figures off it (ImageScript can't decode PDF), so those
// questions come back with no `figures`.
//
// Required edge function secret: GEMINI_API_KEY
// Optional fallback keys: GEMINI_API_KEY_2 .. GEMINI_API_KEY_8 (see getGeminiKeys
// in generate-homework-paper for the rationale — each should belong to a
// separate Google Cloud project for an independent free-tier quota).
// Optional: GEMINI_MODEL (defaults to "gemini-2.5-flash")
//
// Deploy: supabase functions deploy parse-homework-paper

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

// Each file (PDF or image) is sent to Gemini via the File API (raw bytes streamed
// once, referenced by fileUri) rather than base64-inlined into the JSON body —
// same reasoning as generate-homework-paper: inlining a multi-MB file blows the
// edge worker's memory (status 546). Files API keeps worker memory ~flat. A paper
// photographed across several images sends one file part per image;
// MAX_TOTAL_BYTES caps the combined resident size so a pile of photos can't OOM
// the worker, and MAX_PARSE_FILES caps the count.
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_PARSE_FILES = 20;

// Hard ceiling on a single Gemini generateContent call. Supabase edge workers are
// killed at their wall-clock limit (~150s) with a 504 — and when that happens the
// catch block below never runs, so the paper is left showing "Parsing…" forever
// with no error. Aborting the fetch well under that limit turns a silent 504 into
// a clean, surfaced failure the teacher can retry. With the bounded thinkingBudget
// (below) a real parse call returns comfortably under this, so it only fires when a
// call is genuinely stuck.
const GEMINI_CALL_TIMEOUT_MS = 110000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

// Supported upload types and their MIME types. PDFs plus the image formats a
// phone camera / photo library produces (kept in step with the file_type CHECK
// added in 20260726000000_homework_parse_existing_paper.sql). Note: figure
// cropping (resolveFigures/cropFigureFromImage) needs ImageScript to decode
// the page — it reliably decodes jpg/png; webp/heic decode is best-effort and
// falls back to "no figures for that page" rather than failing the parse (the
// question's text/table transcription is unaffected either way, since that
// comes from Gemini reading the original bytes, not from this decode step).
const MIME_BY_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

// Reads every configured Gemini API key (required GEMINI_API_KEY + optional
// GEMINI_API_KEY_2.._8), each expected to be a separate GCP project so it carries
// its own free-tier quota — see generate-homework-paper for the full note.
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
  | "fill_blank"
  | "short_answer"
  | "structured"
  | "extended_response"
  | "essay"
  | "criterion";

const ALL_TYPES: QuestionType[] = [
  "mcq",
  "fill_blank",
  "short_answer",
  "structured",
  "extended_response",
  "essay",
  "criterion",
];
const MARK_SCHEME_TYPES = new Set<QuestionType>([
  "short_answer",
  "structured",
  "extended_response",
  "essay",
  "criterion",
]);

interface MarkSchemePoint {
  point: string;
  marks: number;
}

// A figure/diagram cropped straight out of the source page image (pie chart,
// graph, geometric diagram, a blank grid the student plots on, a photo, …) —
// anything Gemini can't represent as text/Markdown. Stored inline as a data:
// URL so it travels with questions_json with no extra storage lookup. Mirrors
// QuestionFigure in src/types/database.ts.
interface QuestionFigure {
  data_url: string;
  alt?: string;
}

interface GeneratedQuestion {
  id: string;
  block_index: number;
  style: string; // parsed papers: the section title (display-only)
  question_type: QuestionType;
  prompt: string; // GitHub-Flavored Markdown — see EXTRACTION_PROMPT
  marks: number;
  options?: string[];
  correct_option?: number;
  expected_answer?: string;
  acceptable_answers?: string[];
  mark_scheme?: MarkSchemePoint[];
  figures?: QuestionFigure[];
  generated: boolean;
}

interface PaperContent {
  questions: GeneratedQuestion[];
  total_questions: number;
  total_marks: number;
  // The paper's own front-matter (subject/level, date, time allowed,
  // "Instructions to candidates", max-mark statement, …) as Markdown —
  // read-only context, never an answerable question. Absent when the paper
  // has no such front matter. See EXTRACTION_PROMPT.
  paper_instructions?: string;
}

interface PaperBlock {
  count: number;
  style: string;
  // The section's own instruction text printed under its heading (e.g.
  // "Answer all questions in this section...") — read-only, never folded
  // into a question. Absent when the section carried no such text.
  instructions?: string;
  // Shared stimulus / case study / source text / passage / data set that the
  // section's questions refer to (Markdown) plus any figures inside it —
  // shown above the questions, never itself a question. Absent when none.
  stimulus?: string;
  stimulus_figures?: QuestionFigure[];
}

// The subset of the generated_papers row this function reads.
interface PaperRow {
  id: number;
  content_source_type: string;
  content_upload_id: number | null;
  content_upload_ids: number[] | null;
  status: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ---- Gemini structured-output schema ------------------------------------
// A parsed paper mixes question types in one document, so — unlike generation,
// which knows one block is entirely one type — every type-specific field is
// OPTIONAL here and only `question_type`/`prompt`/`marks` are required. The
// model fills options for MCQs, expected_answer for fill-blanks, mark_scheme for
// the rest; code normalizes/coerces afterward (normalizeQuestion).
// Non-text visuals only (charts/diagrams/pictures/photos) — see
// EXTRACTION_PROMPT. A data table belongs in Markdown text, not here. Reused
// for a question's own figures and a section's stimulus/case-study figures.
const figuresSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      page_index: { type: "INTEGER" },
      box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
      alt: { type: "STRING" },
    },
    required: ["page_index", "box_2d"],
  },
};

const questionItemSchema = {
  type: "OBJECT",
  properties: {
    question_type: { type: "STRING", enum: ALL_TYPES },
    prompt: { type: "STRING" },
    marks: { type: "INTEGER" },
    options: { type: "ARRAY", items: { type: "STRING" } },
    correct_option: { type: "INTEGER" },
    expected_answer: { type: "STRING" },
    acceptable_answers: { type: "ARRAY", items: { type: "STRING" } },
    mark_scheme: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { point: { type: "STRING" }, marks: { type: "INTEGER" } },
        required: ["point", "marks"],
      },
    },
    figures: figuresSchema,
  },
  required: ["question_type", "prompt", "marks"],
};

const parseResponseSchema = {
  type: "OBJECT",
  properties: {
    // Paper-level front matter (subject/level, date, time allowed,
    // "Instructions to candidates", max marks) — separate from every
    // section, never a question. See EXTRACTION_PROMPT.
    paper_instructions: { type: "STRING" },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          // This section's own instruction text (e.g. "Answer all questions
          // in this section..."), separate from every question in it.
          instructions: { type: "STRING" },
          // Shared stimulus / case study / source material / passage / data
          // set that this section's questions refer to — Markdown, shown
          // ABOVE the questions. See EXTRACTION_PROMPT.
          stimulus: { type: "STRING" },
          // Figures inside that stimulus (a chart/diagram/photo in the case
          // study itself), cropped the same way a question's figures are.
          stimulus_figures: figuresSchema,
          questions: { type: "ARRAY", items: questionItemSchema },
        },
        required: ["title", "questions"],
      },
    },
  },
  required: ["sections"],
};

// ---- Gemini File API upload ---------------------------------------------

interface GeminiPart {
  text?: string;
  fileData?: { mimeType: string; fileUri: string };
}

// Uploads a file (PDF or image) to the Gemini File API and returns its fileUri.
// Streams the raw bytes (no base64/giant JSON) so worker memory stays flat, and
// waits for the file to become ACTIVE before use. NOTE: a fileUri is scoped to
// the API key's project — re-upload when switching keys (makeFilePartProvider).
async function uploadFileToGemini(
  apiKey: string,
  bytes: Uint8Array,
  mimeType: string,
  displayName: string,
): Promise<string> {
  const numBytes = bytes.length;

  const startResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
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
  if (state === "FAILED") throw new Error("Gemini failed to process the uploaded file");
  return file.uri;
}

interface UploadFile {
  bytes: Uint8Array;
  mimeType: string;
  displayName: string;
}

// Per-key memoized file-parts provider: the first call for a key uploads every
// file (all pages of the paper) under that key's project and caches the in-flight
// promise; a later call with a different key (after rotating off a rate-limited
// one) re-uploads, since fileUris don't carry across keys/projects. The files
// upload in parallel — their bytes are already resident (capped by
// MAX_TOTAL_BYTES), so this adds concurrency, not memory.
function makeFilePartsProvider(
  files: UploadFile[],
): (apiKey: string) => Promise<GeminiPart[]> {
  const cache = new Map<string, Promise<GeminiPart[]>>();
  return (apiKey: string) => {
    let p = cache.get(apiKey);
    if (!p) {
      p = Promise.all(
        files.map((f) =>
          uploadFileToGemini(apiKey, f.bytes, f.mimeType, f.displayName).then(
            (uri): GeminiPart => ({ fileData: { mimeType: f.mimeType, fileUri: uri } }),
          ),
        ),
      );
      cache.set(apiKey, p);
    }
    return p;
  };
}

function parseRetryDelayMs(body: string): number | null {
  const m = body.match(/retry in ([\d.]+)s/i) ?? body.match(/"retryDelay":\s*"([\d.]+)s"/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

// MAX_GEMINI_ATTEMPTS is the number of SWEEPS over the whole key ring (each sweep
// tries every configured key once) — same shape as generate-homework-paper.
const MAX_GEMINI_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 60000;

// Calls Gemini with the file part + extraction prompt, rotating across every
// configured key on a transient failure (429/503/500) before waiting out the
// last retry hint and sweeping again. A non-transient failure on every key
// aborts immediately. Low temperature — this is transcription, not creation.
async function callGemini(
  apiKeys: string[],
  textPrompt: string,
  getFileParts: (apiKey: string) => Promise<GeminiPart[]>,
  schema: unknown,
): Promise<unknown> {
  if (apiKeys.length === 0) throw new Error("No Gemini API keys configured");
  let lastError: Error | null = null;

  for (let sweep = 0; sweep < MAX_GEMINI_ATTEMPTS; sweep++) {
    let anyTransient = false;
    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      try {
        const fileParts = await getFileParts(apiKey);
        const parts: GeminiPart[] = [{ text: textPrompt }, ...fileParts];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GEMINI_CALL_TIMEOUT_MS);
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.2,
                // A BOUNDED thinking budget — not 0, not the default unbounded
                // "dynamic" thinking. Fully disabling thinking made the model
                // misalign a paper's ✓/✗ marks to the wrong option (it needs some
                // reasoning to read an answer key off the page); the default
                // unbounded thinking is what blew the edge worker's 504 timeout on
                // a big paper. This cap keeps mark-reading accurate while staying
                // well under the wall-clock limit (a thinking-off parse of a
                // 100-question paper ran ~60s, leaving ample room for this).
                thinkingConfig: { thinkingBudget: 4096 },
              },
            }),
          },
        ).finally(() => clearTimeout(timeoutId));
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
        // A timeout means the model itself is stuck — fail fast rather than
        // sweeping the remaining keys and risking the edge worker's 504, so the
        // outer catch can surface a clean error instead of the request dying.
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(`Gemini timed out after ${GEMINI_CALL_TIMEOUT_MS / 1000}s`);
        }
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

// ---- Normalization -------------------------------------------------------

interface RawSection {
  title?: unknown;
  instructions?: unknown;
  stimulus?: unknown;
  stimulus_figures?: unknown;
  questions?: unknown;
}

// Coerces one extracted question into a mark-scheme-graded GeneratedQuestion,
// synthesizing a single point from any extracted answer if the model gave no
// usable mark scheme (so every question is still gradable and editable). Used
// both for genuine subjective questions and as the fallback when an "MCQ"/
// "fill_blank" couldn't be read cleanly.
function asMarkSchemeQuestion(
  base: GeneratedQuestion,
  raw: Record<string, unknown>,
  fallbackMarks: number,
): GeneratedQuestion {
  const type = MARK_SCHEME_TYPES.has(base.question_type) ? base.question_type : "short_answer";
  let ms: MarkSchemePoint[] = Array.isArray(raw.mark_scheme)
    ? (raw.mark_scheme as unknown[])
        .filter(
          (p): p is Record<string, unknown> =>
            isRecord(p) &&
            typeof p.point === "string" &&
            p.point.trim().length > 0 &&
            typeof p.marks === "number" &&
            p.marks >= 1,
        )
        .map((p) => ({ point: (p.point as string).trim(), marks: Math.round(p.marks as number) }))
    : [];
  if (ms.length === 0) {
    const answer =
      typeof raw.expected_answer === "string" && raw.expected_answer.trim()
        ? raw.expected_answer.trim()
        : "Correct and complete response (refer to the original paper's mark scheme).";
    ms = [{ point: answer, marks: fallbackMarks }];
  }
  return {
    ...base,
    question_type: type,
    mark_scheme: ms,
    marks: ms.reduce((s, p) => s + p.marks, 0),
  };
}

// GFM tables must be BLOCK-LEVEL — each row on its own line, preceded by a
// header + `|---|` separator — or react-markdown renders them as run-together
// text. Gemini sometimes ignores that and emits a whole table inline on one
// line (e.g. "The table: | a | b | |---|---| | 1 | 2 | | 3 | 4 |"), which the
// UI then shows as a collapsed single line. This reflows such a collapsed
// table back onto proper lines so it renders as a real table everywhere (the
// attempt/review UI and the PDF/DOCX export). Conservative: only a single line
// that actually carries a `|---|` separator AND enough surrounding cells to
// rebuild a header + at least one body row is rewritten; anything already
// well-formed (a separator on its own line, each row on its own line) is left
// exactly as-is, and anything it can't parse confidently is returned unchanged.
const SEP_CELL_RE = /^:?-{2,}:?$/;

function pipeRunToTable(run: string): string | null {
  const cells = run.split("|").map((c) => c.trim());
  // Drop the empty cells produced by the run's own leading/trailing pipe.
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();

  const firstSep = cells.findIndex((c) => SEP_CELL_RE.test(c));
  if (firstSep < 0) return null;
  let lastSep = firstSep;
  while (lastSep + 1 < cells.length && SEP_CELL_RE.test(cells[lastSep + 1])) lastSep++;
  const n = lastSep - firstSep + 1; // column count, from the separator group
  if (n < 1) return null;

  // Header = the n cells immediately before the separator. A single joint-empty
  // cell can sit between the header and the separator (from the `| |` where the
  // header row's closing pipe meets the separator's opening pipe) — drop it.
  let beforeSep = cells.slice(0, firstSep);
  if (beforeSep.length && beforeSep[beforeSep.length - 1] === "") beforeSep = beforeSep.slice(0, -1);
  if (beforeSep.length < n) return null;
  const header = beforeSep.slice(beforeSep.length - n);

  // Body: everything after the separator. Each collapsed row is preceded by a
  // single joint-empty cell (the `| |` where two rows meet, or the space after
  // the separator), so skip one leading empty per row, then take n real cells.
  // A genuinely blank fill-in cell sits INSIDE the n taken cells, so it survives.
  const afterSep = cells.slice(lastSep + 1);
  const rows: string[][] = [];
  for (let i = 0; i < afterSep.length; ) {
    if (afterSep[i] === "") i++; // joint-empty marking the row boundary
    if (i >= afterSep.length) break;
    const row = afterSep.slice(i, i + n);
    while (row.length < n) row.push(""); // keep the table rectangular
    rows.push(row);
    i += n;
  }
  if (rows.length === 0) return null;

  const toLine = (r: string[]) => `| ${r.join(" | ")} |`;
  const sep = `| ${Array(n).fill("---").join(" | ")} |`;
  return [toLine(header), sep, ...rows.map(toLine)].join("\n");
}

function reflowInlineTableLine(line: string): string {
  // Only act when a separator appears mid-line alongside other table content.
  if (!/\|\s*:?-{2,}:?\s*\|/.test(line)) return line;
  const runMatch = line.match(/(?:\|[^|\n]*)+\|/);
  if (!runMatch || runMatch.index === undefined) return line;
  const run = runMatch[0];
  const table = pipeRunToTable(run);
  if (!table) return line; // couldn't parse confidently — leave untouched

  const before = line.slice(0, runMatch.index).trim();
  const after = line.slice(runMatch.index + run.length).trim();
  const parts: string[] = [];
  if (before) parts.push(before, "");
  parts.push(table);
  if (after) parts.push("", after);
  return parts.join("\n");
}

function reflowInlineTables(md: string): string {
  return md.split("\n").map(reflowInlineTableLine).join("\n");
}

// Turns one raw extracted question into a stored GeneratedQuestion, or null to
// skip (empty prompt). Lenient by design — a real paper's text is authoritative,
// so anything unreadable as its declared type is downgraded to a mark-scheme
// question the teacher can fix, never dropped.
function normalizeQuestion(
  raw: unknown,
  blockIndex: number,
  id: string,
): GeneratedQuestion | null {
  if (!isRecord(raw)) return null;
  const prompt = typeof raw.prompt === "string" ? reflowInlineTables(raw.prompt.trim()) : "";
  if (!prompt) return null;

  const declared = raw.question_type;
  const type: QuestionType = ALL_TYPES.includes(declared as QuestionType)
    ? (declared as QuestionType)
    : "short_answer";
  const marks =
    typeof raw.marks === "number" && raw.marks >= 1 ? Math.round(raw.marks) : 1;

  const base: GeneratedQuestion = {
    id,
    block_index: blockIndex,
    style: "",
    question_type: type,
    prompt,
    marks,
    generated: true,
  };

  if (type === "mcq") {
    const options = Array.isArray(raw.options)
      ? (raw.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : [];
    if (options.length < 2) return asMarkSchemeQuestion(base, raw, marks);
    let correct = typeof raw.correct_option === "number" ? Math.round(raw.correct_option) : 0;
    if (correct < 0 || correct >= options.length) correct = 0;
    return { ...base, options, correct_option: correct };
  }

  if (type === "fill_blank") {
    const expected = typeof raw.expected_answer === "string" ? raw.expected_answer.trim() : "";
    if (!expected) return asMarkSchemeQuestion(base, raw, marks);
    const acceptable = Array.isArray(raw.acceptable_answers)
      ? (raw.acceptable_answers as unknown[])
          .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
          .map((a) => a.trim())
      : [];
    return { ...base, expected_answer: expected, acceptable_answers: acceptable };
  }

  return asMarkSchemeQuestion(base, raw, marks);
}

// ---- Figure cropping ------------------------------------------------------
// Crops a figure Gemini located (box_2d, normalized 0-1000 on one page image)
// out of that page's own bytes and re-encodes it as a small inline PNG data
// URL — the exact pixels from the uploaded paper, not a redrawing. Best-effort:
// an undecodable page (e.g. HEIC, which ImageScript can't decode) or a
// degenerate box just means that question ends up with no figure, never a
// hard failure of the whole parse.
//
// PNG, not JPEG (post-deploy fix, 2026-07-14): the first live parses came back
// with figures that rendered visibly CUT OFF partway down the image. Turned out
// ImageScript's encodeJPEG() was silently returning truncated output (no EOI
// marker at all — confirmed by inspecting a stored figure directly) without
// throwing, so cropFigureFromImage's own try/catch never caught it and the
// broken bytes got stored as-is. Most browsers decode a truncated baseline
// JPEG leniently instead of erroring, which is exactly why it *rendered*
// (partially) rather than showing the "figure could not be displayed"
// fallback. Switched to ImageScript's PNG encoder, which is the more
// heavily-used/tested path in this library and — being lossless — is also
// just a better fit for line-art diagrams/charts/text than JPEG's lossy DCT
// compression. isValidPng() is a defense-in-depth signature+trailer check so
// that if this (or any future) encoder path ever produces bad bytes again, the
// figure is silently skipped (never persisted corrupt) rather than reaching
// the student/teacher as a half-rendered image.
//
// CROP PADDING (2026-07-14): even with valid PNG bytes, figures still looked
// cut off because the model's box_2d hugs the diagram too tightly and drops the
// outer axis labels / grid frame. cropFigureFromImage now pads the box by a
// generous fraction plus an absolute floor before cropping, so the whole figure
// stays inside the crop.
const MAX_FIGURES_PER_QUESTION = 4;
const FIGURE_MAX_DIM = 900; // px, downscale cap so figures stay small in jsonb
const PNG_COMPRESSION = 6; // 0-9, zlib level — a reasonable size/speed balance
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function isValidPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length + PNG_IEND.length) return false;
  const start = bytes.subarray(0, PNG_SIGNATURE.length);
  const end = bytes.subarray(bytes.length - PNG_IEND.length);
  return PNG_SIGNATURE.every((b, i) => start[i] === b) && PNG_IEND.every((b, i) => end[i] === b);
}

async function cropFigureFromImage(img: Image, box: unknown): Promise<string | null> {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const nums = box.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const clamp = (n: number) => Math.max(0, Math.min(1000, n));
  let [ymin, xmin, ymax, xmax] = nums.map(clamp);
  if (xmax <= xmin || ymax <= ymin) return null;
  // Padding so the crop doesn't clip the figure's own border/axis labels. The
  // model's box_2d is often drawn a touch too tight (it hugs the plotted lines
  // and misses the outer axis numbers / grid frame), which is what made live
  // crops still look CUT OFF even after the JPEG→PNG fix. A generous fraction
  // plus an absolute floor (so a small box still gets meaningful breathing
  // room) reliably keeps the whole figure inside the crop; the clamp below
  // keeps it within the page, and grabbing a sliver of surrounding whitespace
  // is far better than clipping the diagram.
  const padX = Math.max((xmax - xmin) * 0.08, 15);
  const padY = Math.max((ymax - ymin) * 0.08, 15);
  xmin = clamp(xmin - padX);
  ymin = clamp(ymin - padY);
  xmax = clamp(xmax + padX);
  ymax = clamp(ymax + padY);

  const px0 = Math.round((xmin / 1000) * img.width);
  const py0 = Math.round((ymin / 1000) * img.height);
  const px1 = Math.round((xmax / 1000) * img.width);
  const py1 = Math.round((ymax / 1000) * img.height);
  const w = px1 - px0;
  const h = py1 - py0;
  if (w < 16 || h < 16) return null; // too small to be a real figure crop

  try {
    const cropped = img.clone().crop(px0, py0, w, h);
    if (cropped.width > FIGURE_MAX_DIM || cropped.height > FIGURE_MAX_DIM) {
      const scale = FIGURE_MAX_DIM / Math.max(cropped.width, cropped.height);
      cropped.resize(
        Math.max(1, Math.round(cropped.width * scale)),
        Math.max(1, Math.round(cropped.height * scale)),
      );
    }
    const png = await cropped.encode(PNG_COMPRESSION);
    if (!isValidPng(png)) return null;
    return `data:image/png;base64,${encodeBase64(png)}`;
  } catch {
    return null;
  }
}

// Resolves one question's raw `figures` (page_index + box_2d from Gemini) into
// cropped QuestionFigure data URLs. Decoded page images are cached across
// questions/figures sharing the same page so a multi-figure page is only
// decoded once.
async function resolveFigures(
  rawFigures: unknown,
  files: UploadFile[],
  pageImageCache: Map<number, Image | null>,
): Promise<QuestionFigure[]> {
  if (!Array.isArray(rawFigures)) return [];
  const out: QuestionFigure[] = [];
  for (const rf of rawFigures.slice(0, MAX_FIGURES_PER_QUESTION)) {
    if (!isRecord(rf)) continue;
    const pageIndex = typeof rf.page_index === "number" ? Math.round(rf.page_index) : -1;
    if (pageIndex < 0 || pageIndex >= files.length) continue;

    let img = pageImageCache.get(pageIndex);
    if (img === undefined) {
      try {
        img = (await Image.decode(files[pageIndex].bytes)) as unknown as Image;
      } catch {
        img = null; // undecodable page (e.g. HEIC) — skip figures on it
      }
      pageImageCache.set(pageIndex, img);
    }
    if (!img) continue;

    const dataUrl = await cropFigureFromImage(img, rf.box_2d);
    if (dataUrl) {
      const alt = typeof rf.alt === "string" ? rf.alt.trim() : "";
      out.push({ data_url: dataUrl, ...(alt ? { alt } : {}) });
    }
  }
  return out;
}

// Flattens the model's sections into (blocks, questions): one block per
// non-empty section (its title becomes the block's display label and each
// question's style), questions renumbered q1..qN across the whole paper.
async function buildContent(
  sections: RawSection[],
  files: UploadFile[],
): Promise<{ content: PaperContent; blocks: PaperBlock[] }> {
  const blocks: PaperBlock[] = [];
  const questions: GeneratedQuestion[] = [];
  const pageImageCache = new Map<number, Image | null>();
  let blockIndex = 0;

  for (const sec of sections) {
    const rawQuestions = Array.isArray(sec?.questions) ? (sec.questions as unknown[]) : [];
    const built: GeneratedQuestion[] = [];
    for (const rq of rawQuestions) {
      const q = normalizeQuestion(rq, blockIndex, `q${questions.length + built.length + 1}`);
      if (!q) continue;
      if (isRecord(rq) && rq.figures) {
        const figures = await resolveFigures(rq.figures, files, pageImageCache);
        if (figures.length) q.figures = figures;
      }
      built.push(q);
    }
    if (built.length === 0) continue;
    const title =
      typeof sec?.title === "string" && sec.title.trim()
        ? sec.title.trim()
        : sections.length > 1
          ? `Section ${blockIndex + 1}`
          : "Questions";
    const instructions = typeof sec?.instructions === "string" ? sec.instructions.trim() : "";
    const stimulus =
      typeof sec?.stimulus === "string" && sec.stimulus.trim()
        ? reflowInlineTables(sec.stimulus.trim())
        : "";
    const stimulusFigures = sec?.stimulus_figures
      ? await resolveFigures(sec.stimulus_figures, files, pageImageCache)
      : [];
    for (const q of built) q.style = title;
    blocks.push({
      count: built.length,
      style: title,
      ...(instructions ? { instructions } : {}),
      ...(stimulus ? { stimulus } : {}),
      ...(stimulusFigures.length ? { stimulus_figures: stimulusFigures } : {}),
    });
    questions.push(...built);
    blockIndex += 1;
  }

  // Renumber ids contiguously (built ids assumed the running length, but be
  // explicit so a skipped/empty section can never leave a gap).
  questions.forEach((q, i) => (q.id = `q${i + 1}`));

  return {
    content: {
      questions,
      total_questions: questions.length,
      total_marks: questions.reduce((s, q) => s + q.marks, 0),
    },
    blocks,
  };
}

const EXTRACTION_PROMPT = [
  "You are given one or more page images (photos, scans, or rendered PDF pages) of an EXISTING exam or homework paper.",
  "Your job is to TRANSCRIBE THE FULL PAPER EXACTLY as it appears — every part of it, in the original order, so the result reads like the real paper: front-matter instructions, section instructions, any case study / stimulus / source material / passage / data set, AND the questions. PRESERVE THE ORIGINAL FORMAT (tables, sub-parts, figures) — not just the words. You are NOT writing a new paper, NOT summarizing, and NOT omitting anything: a student must be able to sit this paper from your output alone, so nothing on the page may be left out (except pure copyright/licensing/publisher boilerplate).",
  "Every rule below is about WHERE each piece of the paper goes — questions in `questions`, and all the non-question material into `paper_instructions` / a section's `instructions` / a section's `stimulus`. Do not drop a piece just because it isn't a question.",
  "Rules:",
  "- ONE QUESTION OBJECT PER TOP-LEVEL NUMBER. The paper numbers its questions 1, 2, 3, 4, … (usually with the marks beside each). Emit EXACTLY ONE question object per numbered question, and put ALL of that number's content — its lead-in text, every labelled sub-part ((a), (b), (c), (i), (ii), roman numerals, bullets), any data table, and everything else printed under that number — together inside that one object's `prompt`. NEVER split a single numbered question's sub-parts into separate question objects: if question 3 has parts (a), (b) and (c), that is ONE object, not three. Section the paper strictly by its printed question numbers.",
  "- PAPER-LEVEL INSTRUCTIONS. Separately from every question, transcribe the paper's own front matter — anything printed BEFORE the numbered questions begin — into the top-level `paper_instructions` field as Markdown: the subject/level/paper name, date/session, time allowed, any 'Instructions to candidates' (or similarly named) list, and the maximum-mark statement. A short heading plus a bullet list works well. Do NOT include copyright, licensing, publisher, or 'do not reproduce without permission' boilerplate — that is never useful to a teacher or student reading this and must be left out entirely. Leave `paper_instructions` empty if the paper has no such front matter.",
  "- SECTION-LEVEL INSTRUCTIONS. If a section (e.g. 'Section A') has its own instruction text directly under its heading (e.g. 'Answer all questions in this section. Marks will be awarded for...'), transcribe that text — and ONLY that text — into that section's own `instructions` field, verbatim. Do not repeat it inside any question's `prompt`, and do not turn it into a question.",
  "- CASE STUDIES / STIMULUS / SOURCE MATERIAL — THIS IS CRITICAL, DO NOT DROP IT. Many papers give shared material that a group of questions refer to but is NOT itself a question: a case study, a scenario, a reading passage/extract, a source text, a data set/table, a set of stimulus figures, dialogue, a story, etc. You MUST transcribe this material in FULL, verbatim, into the `stimulus` field of the section whose questions refer to it — it renders ABOVE those questions, exactly like the real paper shows the material first and then asks about it.",
  "    * Reproduce it EXACTLY as printed — same title, same paragraphs, same line breaks, same lists, same emphasis, same everything. Do not summarize, shorten, rephrase, reorder, or 'clean it up' in any way. `stimulus` is Markdown: keep the material's title/heading (as a Markdown heading like `## Before One PLC (BON)` or bold), keep EVERY line break and paragraph break exactly where the paper has them (a BLANK LINE between paragraphs, and one line per printed line within a paragraph — NEVER run separate lines or paragraphs together into one), keep bullet/numbered lists as real Markdown lists, keep *italic*/**bold** where the source uses them, and transcribe any data table as a real block-level Markdown table per the FORMATTING rule below.",
  "    * LINE NUMBERS: if the material has line numbers down the margin (e.g. 5, 10, 15 …, used so a question can say 'line 33'), reproduce them EXACTLY. Transcribe the passage line by line following the paper's own line breaks, and put each margin line number at the very START of the line it labels (e.g. a line beginning `5 In 2016, BON converted…`). Do not drop, move, or renumber them — questions depend on them lining up.",
  "    * If different groups of questions have different stimuli, split them into separate sections so each stimulus sits with the questions that use it. If the stimulus contains a genuine visual (a chart, diagram, photo, map), add it to that section's `stimulus_figures` array (same `page_index`/`box_2d`/`alt` shape as a question's figures).",
  "    * WHERE TO FIND IT: the case study / source material is very often printed on its OWN page(s) — usually the EARLIER pages, before the numbered questions begin (sometimes labelled 'Case study', 'Resource booklet', 'Insert', or just a titled passage). Read EVERY page you are given, front to back, and do not assume the source material is missing just because it isn't on the same page as the questions. If a question cites a line number ('line 33', 'lines 38–50') or refers to a case study / the text / a scenario, then that numbered source text MUST exist somewhere in these pages and you MUST transcribe it into `stimulus`.",
  "    * NEVER omit a case study or source just because it isn't a question, and NEVER fold it into a question's prompt — it belongs in `stimulus`.",
  "- PER-QUESTION TOPIC LABELS. If an individual question has its own short topic/subheading printed directly above it (e.g. 'Biological approach to understanding behaviour' printed above question 1), keep it as the FIRST line of that question's own `prompt`, formatted as a Markdown bold line (e.g. `**Biological approach to understanding behaviour**`), followed by a blank line and then the question text itself. Do not create a separate question or section for a topic label.",
  "- NEVER turn instructional or front-matter text — paper-level or section-level — into a question object. Only a genuine numbered/lettered item the student must actually answer belongs in `questions`.",
  "- Preserve the structure inside the prompt: the number's lead-in text first, then each labelled sub-part ((a), (b), (i), (ii)…) on its own line/paragraph exactly as printed, including the marks shown against each individual sub-part.",
  "- Include every numbered question in the original order. Do not invent, add, merge across numbers, drop, summarize, or reword. Copy the wording verbatim (fix only obvious OCR artefacts and line-break noise).",
  "- FORMATTING — `prompt` is GitHub-Flavored Markdown, not plain text. Use it to mirror the paper's actual layout:",
  "    * A table of data (rows/columns of text or numbers — a schedule, a frequency table, a price list, etc.) MUST be transcribed as a real, BLOCK-LEVEL GitHub-Flavored Markdown table. Put a BLANK LINE before it, then the header row on its own line, then the `|---|---|` separator row on its OWN line, then EACH data row on its OWN separate line, then a blank line after. NEVER write the whole table inline on one line and NEVER run the rows into the surrounding sentence — every single row goes on its own line. Keep every row/column exactly as printed; leave a cell the student must fill in genuinely blank (write it as an empty cell `|  |`) — never guess a value for it.",
  "    * Use *italic*/**bold**, and notation like `x^2`, `H_2O` where the paper itself uses emphasis/exponents/subscripts.",
  "    * Only use Markdown to represent something that is actually on the page — this is transcription, not restyling.",
  "- FIGURES — if, and only if, a question contains a genuine visual that Markdown text/tables cannot represent (a pie chart, bar/line graph, geometric diagram, map, picture, or a blank axes grid the student must plot on), do NOT try to describe it inside `prompt`. Instead add one entry per figure to that question's `figures` array:",
  "    * `page_index` — the 0-based index of the page IMAGE the figure appears on, counting in the order the images were provided to you (0 = the first image).",
  "    * `box_2d` — a TIGHT bounding box around just that figure (excluding the surrounding question text) as `[ymin, xmin, ymax, xmax]`, each an integer 0–1000 normalized to that page image's full width/height.",
  "    * `alt` — a one-sentence description of what the figure shows.",
  "  A table of data is NOT a figure — put it in `prompt` as a Markdown table instead, per the rule above.",
  "- Classify each numbered question by its OVERALL shape: use 'mcq' only if the WHOLE numbered question is a single multiple-choice item with listed options, and 'fill_blank' only if it is a single short exact answer / gap to fill. If the numbered question has multiple sub-parts, or asks for any worked/explained/extended response, use one of 'short_answer' / 'structured' / 'extended_response' / 'essay' / 'criterion' and give it a mark_scheme whose points cover every sub-part and sum to the question's total marks.",
  "- Read the marks shown on the paper (e.g. '[3]', '(2 marks)'). If a question shows no marks, assign a sensible whole number.",
  "- ANSWER KEY — decide this PER QUESTION. First look at whether the paper ALREADY marks the answer. Papers very often do: a tick/check (✓) beside the correct option and/or a cross (✗) beside the wrong ones, a highlighted / circled / bold / coloured / underlined option, an 'Ans:' or 'Answer:' label, a worked solution, or a separate answer-key / solutions section elsewhere in the document.",
  "    * MARK CONVENTION: a tick (✓), highlight, circle, colour, or bold indicates the CORRECT option. A cross (✗) indicates an INCORRECT option. Exactly one option is the answer.",
  "    * Read the marks CAREFULLY and per option: go option by option, top to bottom, and match each mark to the specific option it sits against. Do not skim. The correct option is often NOT the first one.",
  "    * If the paper marks the answer, USE THE PAPER'S OWN ANSWER exactly as marked — treat it as authoritative. Do NOT override it, 'correct' it, or substitute your own judgement, even if you believe it is wrong. NEVER choose an option that carries a cross (✗).",
  "    * Only when the paper does NOT mark the answer for a question should you work out the answer key yourself.",
  "- Fill the answer into the schema for every question either way:",
  "    * mcq: give the options exactly as written (top to bottom), and set correct_option to the 0-based index of the option that carries the correct-answer mark (the ticked / highlighted one). Count from 0 at the top option and make sure the index lands on the marked option — do NOT default to 0. Only if no option is marked at all, use the option you determine is correct.",
  "    * fill_blank: give expected_answer (the paper's stated answer if it shows one, otherwise the model answer) and acceptable_answers (equivalent variants that should also be accepted).",
  "    * everything else: give a mark_scheme as a list of individually creditworthy points, each with its own marks, together summing to the question's marks — following the paper's own solution / mark scheme when it provides one, otherwise writing one yourself.",
  "- Group the questions into the paper's own sections if it has them (e.g. 'Section A', 'Part 1', 'Reading Comprehension'), each with its own `title` and, if present, its `instructions` text per the rule above. If it has no sections, return a single section titled 'Questions'.",
  "Return JSON matching the provided schema and nothing else.",
].join("\n");

// Appended when the paper was uploaded as several images (one per page).
const MULTI_PAGE_NOTE = [
  "The attached files are consecutive pages/photos of a SINGLE paper, provided in order.",
  "Treat them as one continuous document: a question may run across a page break, and question numbering continues from one file to the next. Extract the whole paper across all of them, and do not duplicate a question that spans two pages.",
  "IMPORTANT: the shared case study / source material / stimulus is frequently on a DIFFERENT page from the questions — commonly one of the earlier pages. Transcribe it into `stimulus` regardless of which page it is on; never skip it just because the questions are on a later page.",
].join("\n");

// A forceful recovery instruction used for a targeted retry when the first
// extraction produced questions that clearly rely on shared source material
// (they cite line numbers or a case study) yet no `stimulus` was captured —
// i.e. the model dropped the case study. See the extraction loop in serve().
const STIMULUS_RECOVERY_NOTE = [
  "Your previous attempt DROPPED the shared case study / source material.",
  "The questions you extracted refer to it — they cite line numbers (e.g. 'line 33', 'lines 38–50') and/or mention a case study — which is only possible if a case study, scenario, or numbered source passage is printed somewhere in these pages, usually on an EARLIER page before the questions.",
  "Look through EVERY page again, find that material, and transcribe it IN FULL and verbatim into the `stimulus` field of the section whose questions refer to it (keep its title, every paragraph and line break, and put each margin line number at the start of the line it labels). Do NOT summarize or skip it. Keep all the questions you already found.",
].join("\n");

// Does any question rely on shared source material the paper should print
// above the questions? Line citations ("line 33", "lines 38–50") or an explicit
// "case study" reference are high-precision signals that a `stimulus` must
// exist — used only to trigger a recovery retry, never to fail the parse.
function referencesSharedSource(questions: GeneratedQuestion[]): boolean {
  const re = /\blines?\s*\d|\bcase stud(?:y|ies)\b/i;
  return questions.some((q) => re.test(q.prompt));
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
  try {
    const body = await req.json();
    paperId = body.paper_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!paperId) return jsonResponse({ error: "paper_id is required" }, 400);

  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0)
    return jsonResponse({ error: "GEMINI_API_KEY secret is not configured" }, 500);

  // RLS scopes this to rows the caller may see (own papers / admin / PC).
  const { data: paperData, error: paperError } = await callerClient
    .from("generated_papers")
    .select("*")
    .eq("id", paperId)
    .single();
  if (paperError || !paperData) return jsonResponse({ error: "Paper not found" }, 404);
  const paper = paperData as PaperRow;

  if (paper.content_source_type !== "parsed") {
    return jsonResponse(
      { error: `This paper's source is '${paper.content_source_type}', not a parsed upload.` },
      400,
    );
  }
  if (paper.status !== "draft") {
    return jsonResponse({ error: `Paper status is '${paper.status}', not 'draft'` }, 400);
  }
  if (!paper.content_upload_id) {
    return jsonResponse({ error: "Parsed paper is missing content_upload_id" }, 400);
  }

  // Clear any previous failure so the UI reads this as "parsing" while it runs.
  await callerClient.from("generated_papers").update({ generation_error: null }).eq("id", paperId);

  // The uploaded page(s): content_upload_ids (ordered) when the paper was
  // photographed across several images, else the single content_upload_id.
  const uploadIds: number[] =
    Array.isArray(paper.content_upload_ids) && paper.content_upload_ids.length
      ? paper.content_upload_ids
      : paper.content_upload_id != null
        ? [paper.content_upload_id]
        : [];

  try {
    if (uploadIds.length === 0) throw new Error("Parsed paper has no uploaded file to read");
    if (uploadIds.length > MAX_PARSE_FILES) {
      throw new Error(`Too many uploaded files (${uploadIds.length}, max ${MAX_PARSE_FILES}).`);
    }

    await callerClient
      .from("content_uploads")
      .update({ parse_status: "processing", parse_error: null })
      .in("id", uploadIds);

    // Load + download every page in parallel (Promise.all preserves the paper's
    // page order), then cap the combined size so a big pile of photos can't OOM
    // the worker. The parallel Gemini upload downstream already assumes every
    // file's bytes are resident at once, so downloading them concurrently doesn't
    // change peak memory — it just removes a needless per-page round-trip stall.
    const files: UploadFile[] = await Promise.all(
      uploadIds.map(async (id): Promise<UploadFile> => {
        const { data: upload, error: uploadError } = await callerClient
          .from("content_uploads")
          .select("*")
          .eq("id", id)
          .single();
        if (uploadError || !upload) throw new Error("Could not load an uploaded file record");

        const fileType = String(upload.file_type ?? "").toLowerCase();
        const mimeType = MIME_BY_TYPE[fileType];
        if (!mimeType) {
          throw new Error(
            `Can't parse a '${fileType}' file — upload a PDF or a photo (JPG/PNG/WebP/HEIC) of the paper.`,
          );
        }

        const { data: fileBlob, error: downloadError } = await callerClient.storage
          .from("homework-content")
          .download(upload.file_url);
        if (downloadError || !fileBlob) {
          throw new Error(
            `Could not download an uploaded file: ${downloadError?.message ?? "unknown error"}`,
          );
        }
        const bytes = new Uint8Array(await fileBlob.arrayBuffer());
        return { bytes, mimeType, displayName: upload.file_name ?? "paper" };
      }),
    );

    const totalBytes = files.reduce((sum, f) => sum + f.bytes.length, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `Uploaded files are too large in total (max ~${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB) — upload fewer or smaller photos.`,
      );
    }

    const getFileParts = makeFilePartsProvider(files);
    const basePrompt =
      files.length > 1 ? `${EXTRACTION_PROMPT}\n\n${MULTI_PAGE_NOTE}` : EXTRACTION_PROMPT;

    // Extract, retrying (with a targeted nudge) if the first pass finds no
    // questions OR drops a case study the questions clearly depend on — both
    // observed failure modes. Separate from callGemini's own transient-error
    // key sweeps. The best usable result so far is kept as a fallback, so a
    // recovery retry that still can't find the stimulus never loses the
    // questions we already have.
    let content: PaperContent | null = null;
    let blocks: PaperBlock[] = [];
    let lastIssue: string | null = null;
    const MAX_EXTRACTION_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_EXTRACTION_ATTEMPTS; attempt++) {
      const retryNote = lastIssue ? `\n\n${lastIssue}` : "";
      const result = await callGemini(apiKeys, basePrompt + retryNote, getFileParts, parseResponseSchema);
      const sections =
        isRecord(result) && Array.isArray(result.sections) ? (result.sections as RawSection[]) : [];
      const paperInstructions =
        isRecord(result) && typeof result.paper_instructions === "string"
          ? result.paper_instructions.trim()
          : "";
      const built = await buildContent(sections, files);
      if (built.content.questions.length === 0) {
        lastIssue =
          "Your previous attempt extracted NO questions. Look at the document again and extract every numbered question you can see.";
        continue;
      }

      // Keep this as the best result so far (overwrites a weaker prior attempt).
      content = { ...built.content, ...(paperInstructions ? { paper_instructions: paperInstructions } : {}) };
      blocks = built.blocks;

      // If the questions cite a case study / line numbers but no stimulus was
      // captured, the model dropped the shared source material — retry once
      // targeting exactly that. If retries run out, we still ship the questions.
      const hasStimulus = built.blocks.some((b) => (b.stimulus ?? "").trim().length > 0);
      const needsStimulus = referencesSharedSource(built.content.questions);
      if (needsStimulus && !hasStimulus && attempt < MAX_EXTRACTION_ATTEMPTS - 1) {
        lastIssue = STIMULUS_RECOVERY_NOTE;
        continue;
      }
      break;
    }

    if (!content) {
      throw new Error(
        "Couldn't find any questions in the uploaded file(s). Make sure they're clear photos, scans, or a PDF of a question paper and try again.",
      );
    }

    await callerClient
      .from("content_uploads")
      .update({ parse_status: "completed" })
      .in("id", uploadIds);

    const { data: updated, error: updateError } = await callerClient
      .from("generated_papers")
      .update({
        questions_json: content,
        blocks,
        generation_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paperId)
      .select()
      .single();
    if (updateError) throw new Error(`Parsed but could not save paper: ${updateError.message}`);

    return jsonResponse({ paper: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callerClient
      .from("generated_papers")
      .update({ generation_error: message })
      .eq("id", paperId);
    if (uploadIds.length) {
      await callerClient
        .from("content_uploads")
        .update({ parse_status: "failed", parse_error: message })
        .in("id", uploadIds);
    }
    return jsonResponse({ error: message }, 500);
  }
});

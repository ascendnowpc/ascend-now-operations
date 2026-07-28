// Supabase Edge Function: index-content-upload
// Homework Generator PDF indexing (chapter/section outline extraction).
//
// Request body (runs as the calling teacher — RLS-enforced, no service_role):
//   { content_upload_id }
//
// Downloads an uploaded PDF, asks Gemini to extract its chapter -> section
// outline with page ranges, and writes the result to content_uploads.outline
// (+ outline_status). The teacher then picks a chapter/section in the Homework
// Generator and generation is scoped to just those pages (generated_papers.
// content_scope), instead of the whole document.
//
// Required edge function secret: GEMINI_API_KEY
// Optional fallback keys: GEMINI_API_KEY_2 .. GEMINI_API_KEY_8 (see
// getGeminiKeys) — each should belong to a SEPARATE Google Cloud project so it
// carries its own independent free-tier quota; rotating across them multiplies
// effective throughput instead of every call sharing one 20 RPM pool.
// Optional: GEMINI_MODEL (defaults to "gemini-2.5-flash")
//
// Deploy: supabase functions deploy index-content-upload
//
// Scope: PDF only — Gemini reads PDFs natively. PPT/PPTX/DOCX are not indexable
// here (same limitation as generation) and fail with a clear message.

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
// optional GEMINI_API_KEY_2 / _3 / ... fallbacks (capped at 8). Each key is
// expected to belong to a separate Google Cloud project so it carries its own
// independent free-tier quota. (Mirrors generate-homework-paper's
// getGeminiKeys.)
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

interface OutlineSection {
  title: string;
  page_start: number;
  page_end: number;
}
interface OutlineChapter {
  title: string;
  page_start: number;
  page_end: number;
  sections: OutlineSection[];
}
interface ContentOutline {
  chapters: OutlineChapter[];
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

const sectionSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    page_start: { type: "INTEGER" },
    page_end: { type: "INTEGER" },
  },
  required: ["title", "page_start", "page_end"],
};

const outlineSchema = {
  type: "OBJECT",
  properties: {
    chapters: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          page_start: { type: "INTEGER" },
          page_end: { type: "INTEGER" },
          sections: { type: "ARRAY", items: sectionSchema },
        },
        required: ["title", "page_start", "page_end", "sections"],
      },
    },
  },
  required: ["chapters"],
};

// Uploads a PDF to the Gemini File API and returns its fileUri. Streams the raw
// bytes as the request body (no base64, no giant JSON), so worker memory stays
// flat at ~the file size. Waits for the file to finish PROCESSING before use.
// NOTE: a file uploaded under one API key is scoped to that key's Google Cloud
// project — every retry that switches keys must re-upload under the new key.
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

// Normalizes + validates Gemini's raw chapters array: coerce page numbers,
// drop malformed entries.
function normalizeChapters(rawChapters: unknown[]): OutlineChapter[] {
  const chapters: OutlineChapter[] = [];
  for (const raw of rawChapters) {
    if (!isRecord(raw) || typeof raw.title !== "string" || !raw.title.trim()) continue;
    const ps = Number(raw.page_start);
    const pe = Number(raw.page_end);
    if (!Number.isFinite(ps) || !Number.isFinite(pe)) continue;
    const sections: OutlineSection[] = [];
    if (Array.isArray(raw.sections)) {
      for (const s of raw.sections) {
        if (!isRecord(s) || typeof s.title !== "string" || !s.title.trim()) continue;
        const sps = Number(s.page_start);
        const spe = Number(s.page_end);
        if (!Number.isFinite(sps) || !Number.isFinite(spe)) continue;
        sections.push({
          title: s.title.trim(),
          page_start: Math.max(1, Math.round(sps)),
          page_end: Math.max(1, Math.round(spe)),
        });
      }
    }
    chapters.push({
      title: raw.title.trim(),
      page_start: Math.max(1, Math.round(ps)),
      page_end: Math.max(1, Math.round(pe)),
      sections,
    });
  }
  return chapters;
}

const OUTLINE_PROMPT = [
  "You are indexing a textbook, workbook or lesson-notes PDF so a teacher can pick a specific part to build homework from.",
  "Extract the document's structure as an ordered list of chapters, each with its sections.",
  "For every chapter and section, give the title and the page range within THIS PDF file — page_start and page_end are 1-based positions of the actual pages in the attached file (count from the first page of the PDF; if printed page numbers differ from the physical order, use the physical order).",
  "Chapters must be contiguous and in order. A chapter's sections must fall within that chapter's page range.",
  "If the document has no explicit chapters, treat its top-level headings as chapters. If a chapter has no sub-sections, return an empty sections array for it.",
  "Only include real content divisions — skip the cover, table of contents, and index unless they are the only structure available.",
  "Return JSON matching the provided schema and nothing else.",
].join("\n\n");

async function fetchOutlineOnce(apiKey: string, pdfUri: string): Promise<ContentOutline> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: OUTLINE_PROMPT },
              { fileData: { mimeType: "application/pdf", fileUri: pdfUri } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: outlineSchema,
          temperature: 0.1,
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini response was not valid JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.chapters)) {
    throw new Error("Gemini response had no chapters array");
  }
  const chapters = normalizeChapters(parsed.chapters);
  if (chapters.length === 0) throw new Error("Could not extract any chapters from this PDF");
  return { chapters };
}

// MAX_GEMINI_ATTEMPTS is the number of SWEEPS over the whole key ring (not
// retries on one key) — each sweep re-uploads (per key) and re-extracts once
// per configured key. Rotating across keys on a transient failure
// (429/503/500) is strictly faster than waiting on the same key/project's
// quota; a non-transient failure on every key aborts immediately.
const MAX_GEMINI_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 60000;

function parseRetryDelayMs(body: string): number | null {
  const m = body.match(/retry in ([\d.]+)s/i) ?? body.match(/"retryDelay":\s*"([\d.]+)s"/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

async function callGemini(apiKeys: string[], bytes: Uint8Array, displayName: string): Promise<ContentOutline> {
  if (apiKeys.length === 0) throw new Error("No Gemini API keys configured");
  let lastError: Error | null = null;

  for (let sweep = 0; sweep < MAX_GEMINI_ATTEMPTS; sweep++) {
    let anyTransient = false;
    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      try {
        const pdfUri = await uploadPdfToGemini(apiKey, bytes, displayName);
        return await fetchOutlineOnce(apiKey, pdfUri);
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

  let uploadId: number | undefined;
  try {
    const body = await req.json();
    uploadId = body.content_upload_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!uploadId) return jsonResponse({ error: "content_upload_id is required" }, 400);

  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) return jsonResponse({ error: "GEMINI_API_KEY secret is not configured" }, 500);

  // RLS scopes this to uploads the caller may read (their own, or admin/PC).
  const { data: upload, error: uploadError } = await callerClient
    .from("content_uploads")
    .select("*")
    .eq("id", uploadId)
    .single();
  if (uploadError || !upload) return jsonResponse({ error: "Upload not found" }, 404);

  if (upload.file_type !== "pdf") {
    const msg = "Only PDF uploads can be indexed into chapters/sections.";
    await callerClient
      .from("content_uploads")
      .update({ outline_status: "failed", outline_error: msg })
      .eq("id", uploadId);
    return jsonResponse({ error: msg }, 400);
  }

  await callerClient
    .from("content_uploads")
    .update({ outline_status: "processing", outline_error: null })
    .eq("id", uploadId);

  try {
    const { data: fileBlob, error: downloadError } = await callerClient.storage
      .from("homework-content")
      .download(upload.file_url);
    if (downloadError || !fileBlob) {
      throw new Error(`Could not download uploaded file: ${downloadError?.message ?? "unknown"}`);
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) {
      throw new Error(
        `This PDF is too large to index (${(bytes.length / 1024 / 1024).toFixed(1)}MB, max ~50MB). Split it into smaller files, or generate from the whole document instead.`,
      );
    }
    // Upload via the Gemini File API instead of base64-inlining — inlining a
    // multi-MB PDF into the JSON body killed the worker (status 546). callGemini
    // rotates across every configured API key (re-uploading per key) on 429/etc.
    const outline = await callGemini(apiKeys, bytes, upload.file_name ?? "upload.pdf");

    const { error: updateError } = await callerClient
      .from("content_uploads")
      .update({ outline, outline_status: "completed", outline_error: null })
      .eq("id", uploadId);
    if (updateError) throw new Error(`Indexed but could not save outline: ${updateError.message}`);

    return jsonResponse({ outline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callerClient
      .from("content_uploads")
      .update({ outline_status: "failed", outline_error: message })
      .eq("id", uploadId);
    return jsonResponse({ error: message }, 500);
  }
});

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction } from "../lib/edgeFunctions";
import type { GeneratedPaper, GeneratedPaperContent } from "../types/database";

// Loads and edits a single generated_papers row for the Phase 5 review/publish
// page. Unlike useGeneratedPapers (the list, which fires generation and polls),
// this hook awaits each regenerate call directly — the review page is a focused
// single-paper view where the teacher waits for the result of an explicit
// action, so there's a localized spinner rather than background polling.
export function useGeneratedPaper(paperId: number | undefined) {
  const [paper, setPaper] = useState<GeneratedPaper | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!paperId) {
      setPaper(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("generated_papers")
      .select("*")
      .eq("id", paperId)
      .maybeSingle();
    if (error) {
      setError(error.message);
    } else {
      setPaper((data as GeneratedPaper) ?? null);
      setError(null);
    }
    setLoading(false);
  }, [paperId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Marks this paper failed client-side when its processing edge worker was
  // killed before it could write a status itself (a 504/OOM whose catch never
  // runs) — so the review page's "Generating…/Parsing…" state can't spin
  // forever. Conditional so it never overwrites a paper that just finished.
  const markTimedOut = useCallback(
    async (message: string): Promise<void> => {
      if (!paperId) return;
      await supabase
        .from("generated_papers")
        .update({ generation_error: message })
        .eq("id", paperId)
        .is("questions_json", null)
        .is("generation_error", null);
      await refetch();
    },
    [paperId, refetch],
  );

  // Persists edited questions_json straight to the row (manual inline edits —
  // no LLM call). RLS lets the owning teacher update their own draft paper.
  async function saveQuestions(
    content: GeneratedPaperContent,
  ): Promise<{ error: string | null }> {
    if (!paper) return { error: "No paper loaded." };
    const { data, error } = await supabase
      .from("generated_papers")
      .update({ questions_json: content, updated_at: new Date().toISOString() })
      .eq("id", paper.id)
      .select()
      .single();
    if (error) return { error: error.message };
    setPaper(data as GeneratedPaper);
    return { error: null };
  }

  // Calls the processing edge function and swaps in the returned row. For a
  // 'parsed' paper this re-runs parse-homework-paper (transcribe the uploaded
  // paper again) — there is no per-block/per-question AI regeneration for a
  // parsed paper, so any scope is ignored. Otherwise it hits
  // generate-homework-paper scoped to the whole paper, one block, or one question.
  async function regenerate(
    scope: { block?: number; question?: string } = {},
  ): Promise<{ error: string | null }> {
    if (!paper) return { error: "No paper loaded." };
    const isParsed = paper.content_source_type === "parsed";
    const fn = isParsed ? "parse-homework-paper" : "generate-homework-paper";
    const body: Record<string, unknown> = { paper_id: paper.id };
    if (!isParsed && scope.question != null) body.regenerate_question = scope.question;
    else if (!isParsed && scope.block != null) body.regenerate_block = scope.block;

    const { data, error } = await invokeEdgeFunction(fn, { body });
    if (error) {
      // The function writes its own failure to generation_error; reflect it.
      await refetch();
      const message =
        (data as { error?: string } | null)?.error ?? error.message ?? "Generation failed";
      return { error: message };
    }
    const returned = (data as { paper?: GeneratedPaper } | null)?.paper;
    if (returned) setPaper(returned);
    else await refetch();
    return { error: null };
  }

  // The quality-control gate: draft -> published, stamping published_at. This
  // is the first place generated_papers.status is advanced by application code
  // (the state-machine triggers were deliberately deferred in Phase 1).
  async function publish(): Promise<{ error: string | null }> {
    if (!paper) return { error: "No paper loaded." };
    if (!paper.questions_json || paper.questions_json.questions.length === 0) {
      return { error: "Nothing to publish — this paper has no questions yet." };
    }
    const { data, error } = await supabase
      .from("generated_papers")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", paper.id)
      .select()
      .single();
    if (error) return { error: error.message };
    setPaper(data as GeneratedPaper);
    // Fire-and-forget — mirrors the notify-* pattern used elsewhere (e.g.
    // SessionLogFormView's notify-flag/notify-no-show calls): the publish
    // itself already succeeded, so a failed/slow email shouldn't block or
    // fail the teacher's action.
    supabase.functions
      .invoke("notify-homework-published", { body: { paper_id: paper.id } })
      .catch(() => {});
    return { error: null };
  }

  return { paper, loading, error, refetch, markTimedOut, saveQuestions, regenerate, publish };
}

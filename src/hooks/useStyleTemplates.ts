import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { StyleTemplate } from "../types/database";

// Reads the seeded style_templates library (see Phase 2 migration) that
// populates the style dropdown in the paper-composition builder. Any staff
// member can SELECT active templates under RLS.
//
// Only `is_selectable` templates are returned: subject-specific variants
// (e.g. "IBDP · English SL · Section A") are is_selectable=false — the teacher
// picks the generic family ("IBDP — Section A") and generation auto-resolves to
// the matching variant from the paper's subject, so the specific rows must not
// clutter the picker (see 20260721000000_style_templates_subject_hierarchy).
export function useStyleTemplates() {
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("style_templates")
      .select("*")
      .eq("is_active", true)
      .eq("is_selectable", true)
      .order("id", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setTemplates(data as StyleTemplate[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { templates, loading, error, refetch };
}

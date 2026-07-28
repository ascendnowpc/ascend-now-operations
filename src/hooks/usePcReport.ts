import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CoordinatorLog, CoordinatorLogListKey } from "../types/database";

// The 9 star-rating fields on a Performance Coach Log — all on one 0-5 scale,
// so a straight mean across a PC's students is meaningful. Labels/helper text
// mirror CoordinatorLogSections.tsx's Ratings block.
export const PC_RATING_FIELDS: { key: keyof CoordinatorLog; label: string; helperText?: string }[] = [
  { key: "student_engagement_rating", label: "Student Engagement" },
  { key: "parent_engagement_rating", label: "Parent Engagement" },
  { key: "academic_progress_rating", label: "Academic Progress" },
  { key: "referral_potential_rating", label: "Referral Potential" },
  { key: "parent_involvement_rating", label: "Engagement", helperText: "How involved are the parents?" },
  { key: "transformation_outcomes_rating", label: "Transformation / Outcomes", helperText: "Did the student actually grow?" },
  { key: "loyalty_retention_rating", label: "Loyalty / Retention", helperText: "How committed are they?" },
  { key: "referral_advocacy_rating", label: "Referral / Advocacy" },
  { key: "parent_belief_rating", label: "Parent Belief Score" },
];

// The dropdown (single-select) fields. A mean makes no sense for a category, so
// these are aggregated as a distribution instead — a count per option, with the
// most common highlighted. Renewal Status is deliberately excluded: it's the
// automatic per-package snapshot, not something the PC picks on the log.
const PC_OPTION_FIELDS: { key: keyof CoordinatorLog; label: string; listKey: CoordinatorLogListKey }[] = [
  { key: "primary_goal_option_id", label: "Primary Goal", listKey: "primary_goal" },
  { key: "progress_status_option_id", label: "Progress Status", listKey: "progress_status" },
  { key: "biggest_challenge_option_id", label: "Biggest Challenge", listKey: "biggest_challenge" },
  { key: "next_action_option_id", label: "Next Action", listKey: "next_action" },
  { key: "referral_status_option_id", label: "Referral Status", listKey: "referral_status" },
];

export interface RatingAggregate {
  key: string;
  label: string;
  helperText?: string;
  average: number | null; // mean of the non-null values, null when none
  count: number; // how many students contributed a value
}

export interface DistributionItem {
  label: string;
  count: number;
}

export interface DropdownAggregate {
  key: string;
  label: string;
  items: DistributionItem[]; // sorted by count desc, then label
  total: number; // students with a value for this field
}

export interface PcReport {
  loggedStudentCount: number; // assigned students that have at least one PC log
  ratings: RatingAggregate[];
  dropdowns: DropdownAggregate[];
}

// Counts how many students fall into each category for one dropdown field.
// `labelOf` returns the human label for a log's value, or null to skip it
// (unset field) — so it works for both option-id and text-enum columns.
function buildDistribution(
  key: string,
  label: string,
  latest: CoordinatorLog[],
  labelOf: (log: CoordinatorLog) => string | null,
): DropdownAggregate {
  const counts = new Map<string, number>();
  let total = 0;
  for (const log of latest) {
    const lbl = labelOf(log);
    if (lbl == null) continue;
    total += 1;
    counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .map(([lbl, count]) => ({ label: lbl, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { key, label, items, total };
}

// Aggregates the latest Performance Coach Log per assigned student into
// per-PC averages (ratings) and distributions (dropdowns). "Latest per
// student" is used so the report reflects each student's current standing
// (one vote per student), rather than over-weighting students with more logs.
export function usePcReport(studentIds: string[], enabled: boolean): { report: PcReport | null; loading: boolean; error: string | null } {
  const [logs, setLogs] = useState<CoordinatorLog[] | null>(null);
  const [optionLabels, setOptionLabels] = useState<Map<number, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idsKey = studentIds.join(",");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const ids = idsKey ? idsKey.split(",") : [];
    async function load() {
      const [logsRes, optsRes] = await Promise.all([
        ids.length === 0
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from("coordinator_logs")
              .select("*")
              .in("student_id", ids)
              .order("log_date", { ascending: false })
              .order("id", { ascending: false }),
        supabase
          .from("coordinator_log_options")
          .select("id, label")
          .in("list_key", PC_OPTION_FIELDS.map((f) => f.listKey)),
      ]);
      if (cancelled) return;
      if (logsRes.error) { setError(logsRes.error.message); setLoading(false); return; }
      if (optsRes.error) { setError(optsRes.error.message); setLoading(false); return; }
      const labels = new Map<number, string>();
      for (const o of (optsRes.data ?? []) as { id: number; label: string }[]) labels.set(o.id, o.label);
      setOptionLabels(labels);
      setLogs((logsRes.data ?? []) as CoordinatorLog[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [idsKey, enabled]);

  const report = useMemo<PcReport | null>(() => {
    if (!logs || !optionLabels) return null;

    // logs come back newest-first; the first one seen per student is its latest.
    const latestByStudent = new Map<string, CoordinatorLog>();
    for (const log of logs) {
      if (!latestByStudent.has(log.student_id)) latestByStudent.set(log.student_id, log);
    }
    const latest = [...latestByStudent.values()];

    const ratings: RatingAggregate[] = PC_RATING_FIELDS.map(({ key, label, helperText }) => {
      let sum = 0;
      let count = 0;
      for (const log of latest) {
        const v = log[key] as number | null;
        if (v == null) continue;
        sum += v;
        count += 1;
      }
      return { key: String(key), label, helperText, average: count > 0 ? sum / count : null, count };
    });

    const dropdowns: DropdownAggregate[] = PC_OPTION_FIELDS.map(({ key, label }) =>
      buildDistribution(String(key), label, latest, (log) => {
        const id = log[key] as number | null;
        return id == null ? null : optionLabels.get(id) ?? `#${id}`;
      }),
    );

    return { loggedStudentCount: latest.length, ratings, dropdowns };
  }, [logs, optionLabels]);

  return { report, loading, error };
}

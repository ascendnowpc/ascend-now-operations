import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { SiblingUsage } from "../utils/familyPackages";

interface UsageRow {
  student_id: string;
  first_name: string;
  last_name: string;
  sessions: number;
  no_shows: number;
  hours: number | string;
}

/**
 * Per-sibling usage of a set of packages — who spent how much of each pool.
 *
 * Goes through the `family_package_usage_by_student` RPC rather than a
 * client-side GROUP BY over `session_logs`, and that is the whole point: a
 * student must be able to see that their sibling used 12 of the family's hours
 * WITHOUT being able to read any of that sibling's session logs. RLS on
 * session_logs (rightly) shows a student only their own rows, so the totals can
 * only come out of a SECURITY DEFINER aggregate. The RPC re-checks that the
 * caller can see the package before returning anything.
 *
 * Returns a map keyed by package id. A package the caller can't see comes back
 * as an empty list rather than an error — the same way RLS returns no rows.
 */
export function useFamilyPackageUsage(packageIds: number[]) {
  const [usageByPackage, setUsageByPackage] = useState<Map<number, SiblingUsage[]>>(new Map());
  const [loading, setLoading] = useState(true);

  // Joined to a stable string so a fresh array literal on every render doesn't
  // look like a changed dependency and re-fetch forever.
  const key = packageIds.join(",");

  const refetch = useCallback(async () => {
    const ids = key ? key.split(",").map(Number) : [];
    if (ids.length === 0) {
      setUsageByPackage(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    const results = await Promise.all(
      ids.map(async (id) => {
        const { data, error } = await supabase.rpc("family_package_usage_by_student", {
          p_package_id: id,
        });
        if (error) return [id, [] as SiblingUsage[]] as const;
        const rows = ((data ?? []) as UsageRow[]).map((r) => ({
          studentId: r.student_id,
          firstName: r.first_name,
          lastName: r.last_name,
          sessions: r.sessions,
          noShows: r.no_shows,
          // numeric comes back as a string from PostgREST.
          hours: Number(r.hours),
        }));
        return [id, rows] as const;
      }),
    );
    setUsageByPackage(new Map(results));
    setLoading(false);
  }, [key]);

  useEffect(() => { refetch(); }, [refetch]);

  return { usageByPackage, loading, refetch };
}

import { useCallback, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction, describeFunctionError } from "../lib/edgeFunctions";
import type { PackageRenewalRequest } from "../types/database";

export type PackageRenewalRequestWithCourseType = PackageRenewalRequest & {
  course_types: { name: string; color: string } | null;
};

export function useRenewalRequests() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin: every request, newest first.
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("package_renewal_requests")
      .select("*, course_types(name, color)")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { setError(error.message); return []; }
    setError(null);
    return (data ?? []) as PackageRenewalRequestWithCourseType[];
  }, []);

  // PC: their own submitted requests only (RLS also enforces this).
  const fetchMine = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("package_renewal_requests")
      .select("*, course_types(name, color)")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { setError(error.message); return []; }
    setError(null);
    return (data ?? []) as PackageRenewalRequestWithCourseType[];
  }, []);

  // Creates the request row, then triggers the admin-notification email.
  // Kept as two steps (not one DB transaction) since the email send lives
  // in an edge function — if the email fails, the row still exists so the
  // admin will still see it on their next visit to the queue.
  const createRenewalRequest = useCallback(async (input: {
    student_id: string;
    course_type_id: number;
    requested_hours?: number | null;
    package_size_label?: string | null;
    note?: string | null;
    requested_by_teacher_id: number;
  }) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("package_renewal_requests")
      .insert(input)
      .select("*, course_types(name, color)")
      .single();
    setLoading(false);
    if (error || !data) {
      setError(error?.message ?? "Failed to submit renewal request");
      return { data: null, error: error?.message ?? "Failed to submit renewal request" };
    }
    setError(null);
    const row = data as PackageRenewalRequestWithCourseType;
    const { error: notifyError } = await invokeEdgeFunction("notify-renewal-request", {
      body: { renewal_request_id: row.id },
    });
    if (notifyError) console.error("Failed to email admins about the new renewal request:", await describeFunctionError(notifyError));
    return { data: row, error: null };
  }, []);

  // Admin acknowledges a still-pending request — a plain client-side
  // update (admin has RLS ALL on this table), no edge function/email
  // involved, mirroring how lightweight admin state changes are handled
  // elsewhere in this codebase (e.g. package locking).
  const acknowledge = useCallback(async (id: string, adminUserId: string) => {
    const { data, error } = await supabase
      .from("package_renewal_requests")
      .update({ status: "acknowledged", acknowledged_by_user_id: adminUserId, acknowledged_at: new Date().toISOString() })
      .eq("id", id)
      .select("*, course_types(name, color)")
      .single();
    if (error || !data) return { data: null, error: error?.message ?? "Failed to acknowledge request" };
    return { data: data as PackageRenewalRequestWithCourseType, error: null };
  }, []);

  return {
    loading,
    error,
    fetchAll,
    fetchMine,
    createRenewalRequest,
    acknowledge,
  };
}

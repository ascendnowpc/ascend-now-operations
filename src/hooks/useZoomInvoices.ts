import { useCallback, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { ZoomInvoice, ZoomInvoiceWithTeacher } from "../types/database";

export function useZoomInvoices() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMyZoomInvoices = useCallback(async (teacherId: number) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("zoom_invoices")
      .select("*")
      .eq("teacher_id", teacherId)
      .order("period_month", { ascending: false });
    setLoading(false);
    if (error) { setError(error.message); return []; }
    setError(null);
    return (data ?? []) as ZoomInvoice[];
  }, []);

  const fetchAllZoomInvoices = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("zoom_invoices")
      .select("*, teachers(id, first_name, last_name, is_performance_coach)")
      .order("period_month", { ascending: false });
    setLoading(false);
    if (error) { setError(error.message); return []; }
    setError(null);
    return (data ?? []) as ZoomInvoiceWithTeacher[];
  }, []);

  async function uploadZoomInvoiceFile(file: File, teacherId: number, periodMonth: string) {
    const ext = file.name.split(".").pop() ?? "bin";
    const fileName = `zoom-invoices/${teacherId}/${periodMonth}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("session-invoices")
      .upload(fileName, file, { contentType: file.type || undefined, upsert: false });
    if (error) return { url: null, error: error.message };
    const { data } = supabase.storage.from("session-invoices").getPublicUrl(fileName);
    return { url: data.publicUrl, error: null };
  }

  // Uploads the file then inserts/replaces the row for that teacher+month
  // (re-uploading resets status back to "pending" — blocked by RLS once the
  // existing row is already "acknowledged", so an admin has to undo it first).
  const upsertZoomInvoice = useCallback(async (opts: {
    teacherId: number;
    periodMonth: string; // "YYYY-MM-01"
    file: File;
    uploadedByUserId: string;
  }) => {
    setLoading(true);
    const { url, error: uploadError } = await uploadZoomInvoiceFile(opts.file, opts.teacherId, opts.periodMonth);
    if (uploadError || !url) {
      setLoading(false);
      setError(uploadError);
      return { data: null, error: uploadError ?? "Upload failed" };
    }

    const { data, error } = await supabase
      .from("zoom_invoices")
      .upsert({
        teacher_id: opts.teacherId,
        period_month: opts.periodMonth,
        file_url: url,
        uploaded_at: new Date().toISOString(),
        uploaded_by_user_id: opts.uploadedByUserId,
        status: "pending",
        acknowledged_at: null,
        acknowledged_by_user_id: null,
      }, { onConflict: "teacher_id,period_month" })
      .select()
      .single();
    setLoading(false);
    if (error) {
      // RLS silently blocks the update half of the upsert once the existing
      // row is "acknowledged" (only "pending" rows are replaceable), which
      // PostgREST surfaces as a generic "no rows returned" error — give the
      // teacher a message that actually explains what happened.
      const message = error.code === "PGRST116"
        ? "This month's invoice has already been acknowledged and can't be replaced. Contact an admin if it needs a correction."
        : error.message;
      setError(message);
      return { data: null, error: message };
    }
    setError(null);
    return { data: data as ZoomInvoice, error: null };
  }, []);

  const acknowledgeZoomInvoice = useCallback(async (id: number, acknowledgedByUserId: string) => {
    const { error } = await supabase
      .from("zoom_invoices")
      .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by_user_id: acknowledgedByUserId })
      .eq("id", id);
    return { error: error?.message ?? null };
  }, []);

  const unacknowledgeZoomInvoice = useCallback(async (id: number) => {
    const { error } = await supabase
      .from("zoom_invoices")
      .update({ status: "pending", acknowledged_at: null, acknowledged_by_user_id: null })
      .eq("id", id);
    return { error: error?.message ?? null };
  }, []);

  return {
    loading,
    error,
    fetchMyZoomInvoices,
    fetchAllZoomInvoices,
    upsertZoomInvoice,
    acknowledgeZoomInvoice,
    unacknowledgeZoomInvoice,
  };
}

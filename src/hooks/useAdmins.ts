import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Admin } from "../types/database";

// admins is a minimal marker table (id, user_id, phone_number, country) — the
// admin's name/email live on public.users instead (see AdminAdminsPage).
export function useAdmins() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("admins").select("*");
    if (error) {
      setError(error.message);
    } else {
      setAdmins(data as Admin[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function updateAdminByUserId(userId: string, input: Partial<Pick<Admin, "phone_number" | "country">>) {
    const { data, error } = await supabase
      .from("admins")
      .update(input)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (!error && data) {
      setAdmins((prev) => prev.map((a) => (a.user_id === userId ? (data as Admin) : a)));
    }
    return { data: data as Admin | null, error: error?.message ?? null };
  }

  return { admins, loading, error, refetch, updateAdminByUserId };
}

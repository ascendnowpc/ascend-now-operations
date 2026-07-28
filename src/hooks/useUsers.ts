import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { AppUser } from "../types/database";

export function useUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setUsers(data as AppUser[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function updateUser(id: string, input: Partial<AppUser>) {
    const { data, error } = await supabase
      .from("users")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      setUsers((prev) => prev.map((u) => (u.id === id ? (data as AppUser) : u)));
    }
    return { data: data as AppUser | null, error: error?.message ?? null };
  }

  return { users, loading, error, refetch, updateUser };
}

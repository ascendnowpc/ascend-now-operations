import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { getCached, setCached } from "../lib/cache";
import type { Admin } from "../types/database";

// Keyed per user — a cached row must never leak across a sign-out into a
// different account's session.
const cacheKey = (userId: string) => `myAdmin:${userId}`;

type EditableFields = Pick<Admin, "phone_number" | "country">;

/**
 * Resolves the `admins` row belonging to the logged-in user. That row carries
 * the admin's mnemonic id (e.g. ADMS26-1) plus the contact fields that don't
 * exist on public.users — phone number and country. Mirrors
 * useMyTeacherProfile, including the cache seeding: AdminLayout renders on
 * every admin page, and a blank first render would flash the "complete your
 * profile" gate after each navigation.
 */
export function useMyAdminProfile() {
  const { profile } = useAuth();
  const cached = profile ? getCached<Admin>(cacheKey(profile.id)) : undefined;
  const [admin, setAdmin] = useState<Admin | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }

    // A cache hit still revalidates in the background; it just doesn't blank
    // the row out while it does, so nothing flickers.
    const hit = getCached<Admin>(cacheKey(profile.id));
    if (hit) {
      setAdmin(hit);
      setError(null);
      setLoading(false);
    } else {
      setLoading(true);
    }

    supabase
      .from("admins")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else if (!data) {
          // Not fatal: the panel still works, there's just no admins row to
          // read contact details from or to gate on.
          setAdmin(null);
          setError("No admin record is linked to your account yet. Contact another admin.");
        } else {
          setCached(cacheKey(profile.id), data as Admin);
          setAdmin(data as Admin);
          setError(null);
        }
        setLoading(false);
      });
  }, [profile]);

  const updateMyProfile = useCallback(
    async (fields: Partial<EditableFields>) => {
      if (!admin) return { error: "No admin record loaded." };
      const { data, error } = await supabase
        .from("admins")
        .update(fields)
        .eq("id", admin.id)
        .select()
        .single();
      if (error) return { error: error.message };
      if (!data) return { error: "Update failed — no data returned." };
      // Refresh the cache too, or the next mount would serve the pre-edit row.
      if (profile) setCached(cacheKey(profile.id), data as Admin);
      setAdmin(data as Admin);
      return { error: null };
    },
    [admin, profile]
  );

  return { admin, loading, error, updateMyProfile };
}

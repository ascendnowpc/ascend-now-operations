import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { getCached, setCached } from "../lib/cache";
import type { Teacher } from "../types/database";

// Keyed per user — a cached row must never leak across a sign-out into a
// different account's session.
const cacheKey = (userId: string) => `myTeacher:${userId}`;

type EditableFields = Pick<Teacher, "first_name" | "last_name" | "email" | "phone_number" | "country">;

/**
 * Resolves the `teachers` row that belongs to the currently logged-in
 * user. session_logs and teacher_subjects link to teachers.id, not
 * directly to the user's auth id, so most teacher-facing pages need
 * this lookup before they can fetch anything scoped to "my own data."
 */
export function useMyTeacherProfile() {
  const { profile } = useAuth();
  // Seeded from cache so a remount starts with the row already in hand.
  // Every page renders its own TeacherLayout, so navigating remounts this
  // hook — and TeacherLayout picks the sidebar from the teachers flags when
  // the login role doesn't settle it. Starting at `null` each time made the
  // sidebar visibly change shape one render after every navigation.
  const cached = profile ? getCached<Teacher>(cacheKey(profile.id)) : undefined;
  const [teacher, setTeacher] = useState<Teacher | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }

    // A cache hit still revalidates in the background; it just doesn't blank
    // the row out while it does, so nothing flickers.
    const hit = getCached<Teacher>(cacheKey(profile.id));
    if (hit) {
      setTeacher(hit);
      setError(null);
      setLoading(false);
    } else {
      setLoading(true);
    }

    supabase
      .from("teachers")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else if (!data) {
          setError(
            "No teacher profile is linked to your account yet. Contact your admin."
          );
        } else {
          setCached(cacheKey(profile.id), data as Teacher);
          setTeacher(data as Teacher);
          setError(null);
        }
        setLoading(false);
      });
  }, [profile]);

  async function updateMyProfile(fields: Partial<EditableFields>) {
    if (!teacher) return { error: "No teacher profile loaded." };
    const { data, error } = await supabase
      .from("teachers")
      .update(fields)
      .eq("id", teacher.id)
      .select()
      .single();
    if (error) {
      // teachers.email is globally unique — surface that specific case in
      // plain language rather than the raw Postgres constraint-name error.
      if (fields.email !== undefined && /duplicate key.*teachers_email/i.test(error.message)) {
        return { error: "That email is already used by another teacher account." };
      }
      return { error: error.message };
    }
    if (!data) return { error: "Update failed — no data returned." };
    // Refresh the cache too, or the next mount would serve the pre-edit row.
    if (profile) setCached(cacheKey(profile.id), data as Teacher);
    setTeacher(data as Teacher);
    return { error: null };
  }

  return { teacher, loading, error, updateMyProfile };
}

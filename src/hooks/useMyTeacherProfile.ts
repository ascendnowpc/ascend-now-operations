import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import type { Teacher } from "../types/database";

type EditableFields = Pick<Teacher, "first_name" | "last_name" | "email" | "phone_number" | "country">;

/**
 * Resolves the `teachers` row that belongs to the currently logged-in
 * user. session_logs and teacher_subjects link to teachers.id, not
 * directly to the user's auth id, so most teacher-facing pages need
 * this lookup before they can fetch anything scoped to "my own data."
 */
export function useMyTeacherProfile() {
  const { profile } = useAuth();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }

    setLoading(true);
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
          setTeacher(data as Teacher);
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
    setTeacher(data as Teacher);
    return { error: null };
  }

  return { teacher, loading, error, updateMyProfile };
}

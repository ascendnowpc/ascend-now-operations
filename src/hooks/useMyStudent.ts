import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import type { Student } from "../types/database";
import { getCached, setCached } from "../lib/cache";

type EditableFields = Pick<Student, "phone_number" | "graduation_year" | "birthday" | "school" | "email" | "first_name" | "last_name" | "notification_email" | "curriculum" | "address" | "country" | "parent_full_name" | "parent_phone_number" | "report_card_url">;

function cacheKey(userId: string) {
  return `myStudent:${userId}`;
}

// The student record linked to the currently logged-in student account
// (students.user_id = auth.uid()). RLS lets a student read their own row.
//
// StudentLayout calls this on every route change (each student page wraps
// its own StudentLayout), so without a cache the sidebar would disappear
// and reappear on every nav click while this refetches — cached the same
// way useStudents.ts already caches the admin students list.
export function useMyStudent() {
  const { session } = useAuth();
  const initialCached = session?.user ? getCached<Student | null>(cacheKey(session.user.id)) : undefined;
  const [student, setStudent] = useState<Student | null>(initialCached ?? null);
  const [loading, setLoading] = useState(initialCached === undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!session?.user) { setStudent(null); setLoading(false); return; }
      const cached = getCached<Student | null>(cacheKey(session.user.id));
      if (cached !== undefined) {
        setStudent(cached);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data } = await supabase
        .from("students")
        .select("*")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();
      const result = (data as Student | null) ?? null;
      if (!cancelled) {
        setCached(cacheKey(session.user.id), result);
        setStudent(result);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lets a student fill in the profile fields admin never requires up front
  // (phone/graduation year/birthday/school), and — as of 2026-07-09, only from
  // the mandatory first-login gate, never the ongoing Profile tab — their own
  // email/first/last name (last name is optional at enrollment, so this is
  // also the one chance to add/fix it). RLS's `students_update_own` policy
  // (added alongside these columns) scopes this to the caller's own row.
  async function updateMyProfile(fields: Partial<EditableFields>) {
    if (!student) return { error: "No student profile loaded." };
    const { data, error } = await supabase
      .from("students")
      .update(fields)
      .eq("id", student.id)
      .select()
      .single();
    if (error) return { error: error.message };
    if (!data) return { error: "Update failed — no data returned." };
    setStudent(data as Student);
    if (session?.user) setCached(cacheKey(session.user.id), data as Student);
    return { error: null };
  }

  return { student, loading, updateMyProfile };
}

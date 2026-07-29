import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { PcAchievement, PcCardEntry, PcProfile } from "../types/database";

const BUCKET = "pc-profiles";

const PROFILE_ICON_KEYS = ["cap", "book", "certificate", "school", "calendar", "chart", "people", "message", "target", "heart"];

// Education and coach_responsibilities both used to be stored as plain
// strings; coerce those into the current { icon, heading, text } shape so
// old rows keep rendering.
function normalizeCardEntries(value: unknown): PcCardEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): PcCardEntry | null => {
      if (typeof item === "string") {
        return { icon: "cap", heading: item, text: "" };
      }
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        return {
          icon: (PROFILE_ICON_KEYS.includes(o.icon as string) ? o.icon : "cap") as PcCardEntry["icon"],
          heading: typeof o.heading === "string" ? o.heading : "",
          text: typeof o.text === "string" ? o.text : "",
        };
      }
      return null;
    })
    .filter((e): e is PcCardEntry => e !== null);
}

// Achievements can carry one or many university logos. Older rows used a
// single `institution_logo_url`; coerce every row to the `institution_logo_urls`
// array the card/editor now use so both keep rendering.
function normalizeAchievements(value: unknown): PcAchievement[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const a = item as PcAchievement & { institution_logo_url?: string | null };
    const urls = Array.isArray(a.institution_logo_urls)
      ? a.institution_logo_urls.filter((u): u is string => typeof u === "string" && u.trim() !== "")
      : a.institution_logo_url
        ? [a.institution_logo_url]
        : [];
    return { ...a, institution_logo_urls: urls };
  });
}

// The database row is jsonb-heavy; these coerce the loosely-typed columns back
// into the shapes the rest of the app expects.
function normalize(row: Record<string, unknown> | null): PcProfile | null {
  if (!row) return null;
  return {
    ...(row as unknown as PcProfile),
    achievements: normalizeAchievements(row.achievements),
    educator_experience: Array.isArray(row.educator_experience) ? (row.educator_experience as string[]) : [],
    coach_responsibilities: normalizeCardEntries(row.coach_responsibilities),
    education: normalizeCardEntries(row.education),
  };
}

// The fields a coach edits — everything except the server-managed columns.
export type PcProfileDraft = Pick<
  PcProfile,
  | "department"
  | "headline"
  | "photo_url"
  | "about"
  | "achievements"
  | "educator_experience"
  | "coach_responsibilities"
  | "education"
  | "contact_email"
  | "contact_phone"
>;

/**
 * The visual profile row for a given coach (`teachers.id`). RLS lets a coach
 * read + write their own row, and any staff member read anyone's — so this
 * backs both the coach's own editor (`/teacher/pc-profile`) and the admin/
 * teacher directory views. Saving only succeeds on the caller's own row.
 */
export function usePcProfile(teacherId: string | null | undefined) {
  const [profile, setProfile] = useState<PcProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!teacherId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("pc_profiles")
      .select("*")
      .eq("teacher_id", teacherId)
      .maybeSingle();
    if (error) {
      setError(error.message);
    } else {
      setError(null);
      setProfile(normalize(data as Record<string, unknown> | null));
    }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Uploads a new profile photo to the public `pc-profiles` bucket and returns
  // its public URL (caller then saves it onto the row). Namespaced under the
  // coach's teacher id.
  async function uploadPhoto(file: File): Promise<{ url: string | null; error: string | null }> {
    if (!teacherId) return { url: null, error: "No coach profile loaded." };
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${teacherId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) return { url: null, error: uploadError.message };
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  }

  // Creates or updates the coach's own row. `publish` flips is_published true
  // (used by the first-login setup gate). Upsert keyed on the unique
  // teacher_id so it works whether or not a row exists yet.
  async function save(
    draft: PcProfileDraft,
    opts?: { publish?: boolean },
  ): Promise<{ error: string | null }> {
    if (!teacherId) return { error: "No coach profile loaded." };
    const payload: Record<string, unknown> = { teacher_id: teacherId, ...draft };
    if (opts?.publish) payload.is_published = true;
    const { data, error } = await supabase
      .from("pc_profiles")
      .upsert(payload, { onConflict: "teacher_id" })
      .select()
      .single();
    if (error) return { error: error.message };
    setProfile(normalize(data as Record<string, unknown> | null));
    return { error: null };
  }

  return { profile, loading, error, refetch, uploadPhoto, save };
}

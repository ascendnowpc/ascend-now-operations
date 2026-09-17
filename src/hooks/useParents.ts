import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Parent, Student } from "../types/database";
import { getCached, setCached, invalidateCachePrefix } from "../lib/cache";
import { idSeqNumber } from "../utils/entityId";

function byIdNum(a: Parent, b: Parent) {
  return idSeqNumber(a.id) - idSeqNumber(b.id);
}

/**
 * Every parent/guardian account. Admin-facing — RLS lets an admin read them
 * all, staff read them all, and a parent read only their own row.
 *
 * There is deliberately no create here: a parent needs a login, and only the
 * `create-parent-with-user` edge function can make one (exactly the same
 * arrangement as `useTeachers` deferring to `create-teacher-with-user` and
 * `useStudents` to the enrollment workflow). This hook covers reading and
 * editing the record's own fields.
 */
export function useParents() {
  const [parents, setParents] = useState<Parent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const key = "parents:all";
    const cached = getCached<Parent[]>(key);
    if (cached) {
      setParents(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("parents").select("*");
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const rows = ((data ?? []) as Parent[]).sort(byIdNum);
    setCached(key, rows);
    setParents(rows);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  async function updateParent(id: string, input: Partial<Omit<Parent, "id" | "user_id" | "created_at">>) {
    const { data, error } = await supabase
      .from("parents")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      invalidateCachePrefix("parents:");
      setParents((prev) => prev.map((p) => (p.id === id ? (data as Parent) : p)));
    }
    return { data: (data as Parent | null) ?? null, error: error?.message ?? null };
  }

  return { parents, loading, error, refetch, updateParent };
}

// Drops the cached parents list so the next `useParents()` mount refetches.
// Needed because creating a parent goes through the `create-parent-with-user`
// edge function, which never touches this cache — without it, /admin/parents
// and the enroll form's parent picker would keep serving a list without the
// family just added for up to the cache TTL. Mirrors invalidateTeachersCache().
export function invalidateParentsCache() {
  invalidateCachePrefix("parents:");
}

/**
 * The parent row linked to the currently logged-in parent account
 * (parents.user_id = auth.uid()), plus their children.
 *
 * Cached the same way useMyStudent caches the student's own row: ParentLayout
 * re-runs this on every route change (each parent page wraps its own layout),
 * and without a cache the sidebar would blank out and come back on every nav
 * click while it refetched.
 */
export function useMyParent(userId: string | undefined) {
  const cacheKey = userId ? `myParent:${userId}` : null;
  const initial = cacheKey ? getCached<Parent | null>(cacheKey) : undefined;
  const [parent, setParent] = useState<Parent | null>(initial ?? null);
  const [loading, setLoading] = useState(initial === undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) { setParent(null); setLoading(false); return; }
      const key = `myParent:${userId}`;
      const cached = getCached<Parent | null>(key);
      if (cached !== undefined) {
        setParent(cached);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data } = await supabase
        .from("parents")
        .select("*")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      const result = (data as Parent | null) ?? null;
      if (cancelled) return;
      setCached(key, result);
      setParent(result);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // The two fields a parent fills in for themselves at first login
  // (ParentCompleteProfileGate) and can correct afterward from their Profile
  // page. Deliberately narrow: name and email identify the account and are
  // maintained by an admin, and `user_id` is refused outright by the
  // `prevent_non_admin_parent_relink` trigger. RLS's `parents_update_own`
  // scopes the write to the caller's own row.
  async function updateMyParent(
    fields: Partial<Pick<Parent, "country" | "profession" | "phone_number">>,
  ) {
    if (!parent) return { error: "No parent record loaded." };
    const { data, error } = await supabase
      .from("parents")
      .update(fields)
      .eq("id", parent.id)
      .select()
      .single();
    if (error) return { error: error.message };
    const row = (data as Parent | null) ?? null;
    setParent(row);
    if (userId) setCached(`myParent:${userId}`, row);
    invalidateCachePrefix("parents:");
    return { error: null };
  }

  return { parent, loading, updateMyParent };
}

/**
 * The children of the logged-in parent.
 *
 * A plain read of `students` — RLS (`student_parent_read_students` via
 * `can_view_student`) already narrows it to this parent's own children, so
 * there is no filter to get wrong client-side. The explicit `parent_id` filter
 * is still there as a second guard and so the query is self-describing.
 *
 * Ordered by the trailing sequence number of the student id, i.e. the order
 * the children were enrolled — stable, and the same ordering the admin
 * students list uses.
 */
export function useMyChildren(parentId: string | null | undefined) {
  const [children, setChildren] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!parentId) { setChildren([]); setLoading(false); return; }
      const key = `myChildren:${parentId}`;
      const cached = getCached<Student[]>(key);
      if (cached) { setChildren(cached); setLoading(false); return; }
      setLoading(true);
      const { data } = await supabase
        .from("students")
        .select("*")
        .eq("parent_id", parentId);
      if (cancelled) return;
      const rows = ((data ?? []) as Student[]).sort((a, b) => idSeqNumber(a.id) - idSeqNumber(b.id));
      setCached(key, rows);
      setChildren(rows);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [parentId]);

  // A parent filling in a young child's profile — the same fields the child
  // would type into their own first-login form, from the parent's side
  // (2026-09-17). RLS's `parents_update_own_children` scopes this to their own
  // children, and `prevent_non_admin_student_relink` refuses any attempt to
  // move the child to another household or login along the way.
  async function updateChild(studentId: string, fields: Partial<Student>) {
    const { data, error } = await supabase
      .from("students")
      .update(fields)
      .eq("id", studentId)
      .select()
      .single();
    if (error) return { error: error.message };
    const row = data as Student;
    const next = children.map((c) => (c.id === studentId ? row : c));
    setChildren(next);
    if (parentId) setCached(`myChildren:${parentId}`, next);
    // The admin-facing list caches the same rows under its own key.
    invalidateCachePrefix("students:");
    return { error: null };
  }

  return { children, loading, updateChild };
}

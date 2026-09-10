import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { PackageTopup, SessionLog, SessionLogPoolResolution, StudentPackage, Subject, Teacher } from "../types/database";
import { computeHoursUsed, computeHoursUsedBySubject, computeHoursUsedByTeacher } from "../utils/packageHours";

export const PRESET_HOURS = [16, 24, 32, 50, 100];

export function useStudentPackages() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every package a student can draw on, each with its topup history: their
  // own, PLUS their family's — a pool bought once by the parent and shared by
  // every sibling (2026-09-11). `parentId` is the student's own
  // `students.parent_id`; pass null/undefined for a student with no family
  // account and this behaves exactly as it always did.
  //
  // The `or` filter mirrors the `student_package_ids()` SQL helper that the
  // session-log trigger routes deductions through, so what a student is shown
  // they can spend is the same set the database actually lets them spend. RLS
  // (can_view_package) independently enforces the same thing.
  const fetchPackagesForStudent = useCallback(async (studentId: string, parentId?: string | null) => {
    setLoading(true);
    let query = supabase.from("student_packages").select("*, package_topups(*)");
    query = parentId
      ? query.or(`student_id.eq.${studentId},parent_id.eq.${parentId}`)
      : query.eq("student_id", studentId);
    const { data, error } = await query.order("created_at", { ascending: true });
    setLoading(false);
    if (error) {
      setError(error.message);
      return [];
    }
    setError(null);
    return (data ?? []) as (StudentPackage & { package_topups: PackageTopup[] })[];
  }, []);

  // Every package owned by a parent — the family pools, for the admin's parent
  // packages page. A student-owned package never appears here.
  const fetchPackagesForParent = useCallback(async (parentId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("student_packages")
      .select("*, package_topups(*)")
      .eq("parent_id", parentId)
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) {
      setError(error.message);
      return [];
    }
    setError(null);
    return (data ?? []) as (StudentPackage & { package_topups: PackageTopup[] })[];
  }, []);

  // Creates a family pool — owned by the parent, drawn down by every one of
  // their children. Separate from createLabeledPackage rather than a flag on
  // it, because the two are mutually exclusive at the database level
  // (student_packages_one_owner) and a single function taking both ids would
  // just be a runtime error waiting to happen.
  const createFamilyPackage = useCallback(async (opts: {
    parentId: string;
    courseTypeId: number;
    packageTypeId?: number | null;
    poolLabel?: string | null;
    initialHours: number;
    note?: string | null;
    addedByUserId: string;
  }) => {
    const { data, error } = await supabase
      .from("student_packages")
      .insert({
        parent_id: opts.parentId,
        course_type_id: opts.courseTypeId,
        package_type_id: opts.packageTypeId ?? null,
        pool_label: opts.poolLabel ?? null,
      })
      .select()
      .single();
    if (error || !data) return { data: null, error: error?.message ?? "Failed to create package" };

    // Hours arrive as a top-up rather than as total_hours_purchased directly,
    // so the purchase shows up in the package's history the same way every
    // later renewal will — on_package_topup_inserted() is what actually moves
    // total_hours_purchased.
    const { error: topupErr } = await supabase.from("package_topups").insert({
      student_package_id: (data as StudentPackage).id,
      hours_added: opts.initialHours,
      package_size_label: `${opts.initialHours} hours`,
      note: opts.note ?? null,
      added_by_user_id: opts.addedByUserId,
    });
    if (topupErr) {
      return { data: data as StudentPackage, error: `Package created but adding hours failed: ${topupErr.message}` };
    }
    return { data: data as StudentPackage, error: null };
  }, []);

  // Fetch or create the *current* package row for a student+course_type
  // combination — i.e. the unlocked one. A student can have any number of
  // locked (historical) packages for the same course type once one has
  // been locked, so this only ever matches the unlocked row and creates a
  // fresh one if the only existing package for that course type is locked.
  const getOrCreatePackage = useCallback(async (studentId: string, courseTypeId: number) => {
    // Try existing (current, unlocked) first
    const { data: existing } = await supabase
      .from("student_packages")
      .select("*")
      .eq("student_id", studentId)
      .eq("course_type_id", courseTypeId)
      .eq("is_locked", false)
      .maybeSingle();

    if (existing) return { data: existing as StudentPackage, error: null };

    // Create new
    const { data, error } = await supabase
      .from("student_packages")
      .insert({ student_id: studentId, course_type_id: courseTypeId })
      .select()
      .single();
    return { data: data as StudentPackage | null, error: error?.message ?? null };
  }, []);

  // Creates an additional, distinctly-labeled pool for a student+course_type
  // that already has (or will have) other concurrent unlocked pools — e.g.
  // the "Discovery Project" pool alongside a student's default Beyond
  // Academic pool for a Foundation Program package. Unlike
  // getOrCreatePackage, this always inserts a new row rather than reusing
  // an existing unlocked one, since the whole point is to have several
  // active at once.
  //
  // `courseTypeId` is the pool's real matching category (Beyond Academic /
  // College Counselling — what handle_session_log_package_lock() actually
  // matches sessions against). `packageTypeId`, when given, is a *different*
  // course_type (Foundation Program / All-In-One) used purely to group this
  // pool with its siblings on the packages UI — it plays no part in
  // session-to-pool matching.
  const createLabeledPackage = useCallback(async (opts: {
    studentId: string;
    courseTypeId: number;
    packageTypeId?: number | null;
    poolLabel: string | null;
    initialHours: number;
  }) => {
    const { data, error } = await supabase
      .from("student_packages")
      .insert({
        student_id: opts.studentId,
        course_type_id: opts.courseTypeId,
        package_type_id: opts.packageTypeId ?? null,
        pool_label: opts.poolLabel,
        total_hours_purchased: opts.initialHours,
      })
      .select()
      .single();
    return { data: data as StudentPackage | null, error: error?.message ?? null };
  }, []);

  // Locks a package: no more topups or session-log changes can be made
  // against it, and the next renewal for this course type will start a
  // brand-new package generation instead of extending this one (still
  // inheriting the prior generation's bundle/pool membership, so a bundled
  // pool stays in its bundle). Snapshots hours-used at lock time for the
  // record.
  const lockPackage = useCallback(async (opts: { packageId: number; hoursUsed: number; lockedByUserId: string }) => {
    const { error } = await supabase
      .from("student_packages")
      .update({
        is_locked: true,
        locked_at: new Date().toISOString(),
        locked_by_user_id: opts.lockedByUserId,
        locked_hours_used: opts.hoursUsed,
      })
      .eq("id", opts.packageId);
    return { error: error?.message ?? null };
  }, []);

  // Reverses a lock — e.g. an admin locked the wrong package by mistake.
  const unlockPackage = useCallback(async (packageId: number) => {
    const { error } = await supabase
      .from("student_packages")
      .update({ is_locked: false, locked_at: null, locked_by_user_id: null, locked_hours_used: null })
      .eq("id", packageId);
    return { error: error?.message ?? null };
  }, []);

  // Record a top-up (sell a package). Also creates the student_packages row
  // if needed — but only via course_type lookup when no specific pool is
  // given. Once a course_type can have multiple concurrent pools
  // (Foundation Program / All-In-One), getOrCreatePackage's course_type-only
  // match would error trying to disambiguate between them, so topping up an
  // *existing* specific pool must pass its id directly via
  // `studentPackageId` (used by the "+ Add hours" action on a package
  // card, which already knows exactly which pool it's on). Omitting it is
  // only safe for the "sell a brand-new course type" flow, where the
  // student can't yet have more than one pool of that type.
  const addTopup = useCallback(async (opts: {
    studentId: string;
    courseTypeId: number;
    studentPackageId?: number;
    hoursAdded: number;
    packageSizeLabel: string;
    note?: string;
    addedByUserId: string;
  }) => {
    setLoading(true);
    let packageId = opts.studentPackageId;
    if (packageId == null) {
      const { data: pkg, error: pkgErr } = await getOrCreatePackage(opts.studentId, opts.courseTypeId);
      if (pkgErr || !pkg) {
        setLoading(false);
        return { data: null, error: pkgErr ?? "Failed to get package" };
      }
      packageId = pkg.id;
    }

    const { data, error } = await supabase
      .from("package_topups")
      .insert({
        student_package_id: packageId,
        hours_added: opts.hoursAdded,
        package_size_label: opts.packageSizeLabel,
        note: opts.note ?? null,
        added_by_user_id: opts.addedByUserId,
      })
      .select()
      .single();
    setLoading(false);
    if (error) {
      setError(error.message);
      return { data: null, error: error.message };
    }
    setError(null);
    return { data: data as PackageTopup, error: null };
  }, [getOrCreatePackage]);

  // Session logs for this student that couldn't be auto-assigned to a
  // package because more than one active pool exists for their course_type
  // and no (teacher, subject) resolution has been recorded yet — needs a PC
  // to pick which pool each one counts against.
  const fetchPendingPoolSessions = useCallback(async (studentId: string) => {
    const { data, error } = await supabase
      .from("session_logs")
      .select("*, teacher:teachers!session_logs_teacher_id_fkey(id, first_name, last_name), subject:subjects(id, name)")
      .eq("student_id", studentId)
      .eq("pool_ambiguous", true)
      .is("student_package_id", null)
      .order("session_date", { ascending: false });
    if (error) {
      setError(error.message);
      return [];
    }
    return (data ?? []) as (SessionLog & {
      teacher: Pick<Teacher, "id" | "first_name" | "last_name"> | null;
      subject: Pick<Subject, "id" | "name"> | null;
    })[];
  }, []);

  // Unlocked (currently active) pools for a student+course_type — the
  // candidates a PC can assign a session to.
  const fetchActivePoolsForCourseType = useCallback(async (studentId: string, courseTypeId: number) => {
    const { data, error } = await supabase
      .from("student_packages")
      .select("*")
      .eq("student_id", studentId)
      .eq("course_type_id", courseTypeId)
      .eq("is_locked", false)
      .order("created_at", { ascending: true });
    if (error) {
      setError(error.message);
      return [];
    }
    return (data ?? []) as StudentPackage[];
  }, []);

  // Existing sticky (teacher, subject) -> pool mappings for a student, so a
  // PC can see and, if needed, reset one (e.g. once they know a project has
  // changed even though the teacher/subject pairing hasn't).
  const fetchPoolResolutions = useCallback(async (studentId: string) => {
    const { data, error } = await supabase
      .from("session_log_pool_resolutions")
      .select("*, teacher:teachers(id, first_name, last_name), subject:subjects(id, name), student_package:student_packages(id, course_type_id, pool_label)")
      .eq("student_id", studentId);
    if (error) {
      setError(error.message);
      return [];
    }
    return (data ?? []) as (SessionLogPoolResolution & {
      teacher: Pick<Teacher, "id" | "first_name" | "last_name"> | null;
      subject: Pick<Subject, "id" | "name"> | null;
      student_package: Pick<StudentPackage, "id" | "course_type_id" | "pool_label"> | null;
    })[];
  }, []);

  const deletePoolResolution = useCallback(async (resolutionId: number) => {
    const { error } = await supabase.from("session_log_pool_resolutions").delete().eq("id", resolutionId);
    return { error: error?.message ?? null };
  }, []);

  // Resolves a still-ambiguous ("Pending Deduction") session to a specific
  // pool, records the choice as the student's sticky (teacher, subject) ->
  // pool assignment, and sweeps every other still-*unresolved* session
  // matching that same key (student, course_type, teacher, subject) onto
  // the same pool in one go — these haven't been deducted anywhere yet, so
  // they're "upcoming" in the same sense a future session is. This never
  // touches an already-resolved (already deducted) session — the DB trigger
  // guarantees that independently (see handle_session_log_package_lock),
  // and the sweep query itself only ever matches
  // `pool_ambiguous = true AND student_package_id IS NULL` rows.
  const resolvePendingSession = useCallback(async (opts: {
    sessionLogId: number;
    studentPackageId: number;
    resolvedByUserId: string;
  }) => {
    const { data: log, error: logErr } = await supabase
      .from("session_logs")
      .select("student_id, course_type_id, teacher_id, subject_id")
      .eq("id", opts.sessionLogId)
      .single();
    if (logErr || !log || !log.student_id || !log.course_type_id || !log.teacher_id) {
      return { error: logErr?.message ?? "Session log is missing required fields" };
    }

    const { error: resolutionErr } = await upsertPoolResolution({
      studentId: log.student_id,
      courseTypeId: log.course_type_id,
      teacherId: log.teacher_id,
      subjectId: log.subject_id,
      studentPackageId: opts.studentPackageId,
      resolvedByUserId: opts.resolvedByUserId,
    });
    if (resolutionErr) return { error: resolutionErr };

    let sweepQuery = supabase
      .from("session_logs")
      .update({ student_package_id: opts.studentPackageId, pool_ambiguous: false })
      .eq("student_id", log.student_id)
      .eq("course_type_id", log.course_type_id)
      .eq("teacher_id", log.teacher_id)
      .eq("pool_ambiguous", true)
      .is("student_package_id", null);
    sweepQuery = log.subject_id == null ? sweepQuery.is("subject_id", null) : sweepQuery.eq("subject_id", log.subject_id);
    const { error: sweepErr } = await sweepQuery;
    return { error: sweepErr?.message ?? null };
  }, []);

  // Changes which pool a (teacher, subject) resolution rule points to. This
  // is the single dedicated place to change a project assignment "going
  // forward": it updates the rule itself (so any brand-new session logged
  // with that teacher+subject follows it) and sweeps any currently-pending,
  // not-yet-deducted sessions matching the same key onto the new pool — but
  // never touches an already-resolved session, which keeps whatever pool it
  // was already counted against.
  const updatePoolResolutionTarget = useCallback(async (opts: {
    resolutionId: number;
    studentPackageId: number;
    resolvedByUserId: string;
  }) => {
    const { data: resolution, error: fetchErr } = await supabase
      .from("session_log_pool_resolutions")
      .select("student_id, course_type_id, teacher_id, subject_id")
      .eq("id", opts.resolutionId)
      .single();
    if (fetchErr || !resolution) return { error: fetchErr?.message ?? "Assignment rule not found" };

    const { error: updateErr } = await supabase
      .from("session_log_pool_resolutions")
      .update({ student_package_id: opts.studentPackageId, resolved_by_user_id: opts.resolvedByUserId, resolved_at: new Date().toISOString() })
      .eq("id", opts.resolutionId);
    if (updateErr) return { error: updateErr.message };

    let sweepQuery = supabase
      .from("session_logs")
      .update({ student_package_id: opts.studentPackageId, pool_ambiguous: false })
      .eq("student_id", resolution.student_id)
      .eq("course_type_id", resolution.course_type_id)
      .eq("teacher_id", resolution.teacher_id)
      .eq("pool_ambiguous", true)
      .is("student_package_id", null);
    sweepQuery = resolution.subject_id == null ? sweepQuery.is("subject_id", null) : sweepQuery.eq("subject_id", resolution.subject_id);
    const { error: sweepErr } = await sweepQuery;
    return { error: sweepErr?.message ?? null };
  }, []);

  // Proactively sets a (teacher, subject) -> pool assignment before any
  // session has even been logged — e.g. an admin/PC setting up which
  // project a teacher's sessions on a subject should count against ahead
  // of time, rather than waiting for the first ambiguous session and the
  // "Pending Deduction" flow. Same upsert `resolvePendingSession` itself
  // uses, just with no session log to derive the key fields from — the
  // caller supplies student/course type/teacher/subject directly. Only
  // ever affects sessions not yet logged (and any already-pending ones
  // matching the same key, via the trigger's own resolution lookup) —
  // never an already-resolved one.
  const createPoolResolution = useCallback(async (opts: {
    studentId: string;
    courseTypeId: number;
    teacherId: string;
    subjectId: number | null;
    studentPackageId: number;
    resolvedByUserId: string;
  }) => upsertPoolResolution(opts), []);

  // Find-or-update the sticky resolution row (the underlying unique index
  // uses COALESCE(subject_id, -1), which supabase-js can't target via
  // .upsert()'s onConflict, so this mirrors getOrCreatePackage's
  // select-then-insert-or-update pattern instead). Shared by
  // resolvePendingSession's and createPoolResolution's write paths.
  async function upsertPoolResolution(opts: {
    studentId: string;
    courseTypeId: number;
    teacherId: string;
    subjectId: number | null;
    studentPackageId: number;
    resolvedByUserId: string;
  }) {
    let existingQuery = supabase
      .from("session_log_pool_resolutions")
      .select("id")
      .eq("student_id", opts.studentId)
      .eq("course_type_id", opts.courseTypeId)
      .eq("teacher_id", opts.teacherId);
    existingQuery = opts.subjectId == null ? existingQuery.is("subject_id", null) : existingQuery.eq("subject_id", opts.subjectId);
    const { data: existing } = await existingQuery.maybeSingle();

    const { error } = existing
      ? await supabase
          .from("session_log_pool_resolutions")
          .update({ student_package_id: opts.studentPackageId, resolved_by_user_id: opts.resolvedByUserId, resolved_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase
          .from("session_log_pool_resolutions")
          .insert({
            student_id: opts.studentId,
            course_type_id: opts.courseTypeId,
            teacher_id: opts.teacherId,
            subject_id: opts.subjectId,
            student_package_id: opts.studentPackageId,
            resolved_by_user_id: opts.resolvedByUserId,
          });
    return { error: error?.message ?? null };
  }

  // Fetch session logs for a student (only the fields needed for balance calculation)
  const fetchSessionsForBalance = useCallback(async (studentId: string) => {
    const { data, error } = await supabase
      .from("session_logs")
      .select("id, session_date, course_type_id, program_type_id, student_package_id, session_duration_hrs, no_show_type, subject_id, curriculum_id, teacher_id, pool_ambiguous")
      .eq("student_id", studentId);
    if (error) {
      setError(error.message);
      return [];
    }
    return (data ?? []) as Pick<SessionLog, "id" | "session_date" | "course_type_id" | "program_type_id" | "student_package_id" | "session_duration_hrs" | "no_show_type" | "subject_id" | "curriculum_id" | "teacher_id" | "pool_ambiguous">[];
  }, []);

  return {
    loading,
    error,
    fetchPackagesForStudent,
    fetchPackagesForParent,
    createFamilyPackage,
    getOrCreatePackage,
    createLabeledPackage,
    addTopup,
    lockPackage,
    unlockPackage,
    computeHoursUsed,
    computeHoursUsedBySubject,
    computeHoursUsedByTeacher,
    fetchSessionsForBalance,
    fetchPendingPoolSessions,
    fetchActivePoolsForCourseType,
    fetchPoolResolutions,
    deletePoolResolution,
    resolvePendingSession,
    updatePoolResolutionTarget,
    createPoolResolution,
  };
}


/**
 * Every family (parent-owned) package in one read.
 *
 * For list screens that need a balance per family — the admin Parents list —
 * where a query per row would be one round trip per family. RLS still applies:
 * an admin sees all of them, a parent only their own.
 */
export function useFamilyPackages() {
  const [familyPackages, setFamilyPackages] = useState<StudentPackage[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("student_packages")
      .select("*")
      .not("parent_id", "is", null);
    setFamilyPackages((data ?? []) as StudentPackage[]);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { familyPackages, loading, refetch };
}

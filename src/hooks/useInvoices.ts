import { useCallback, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Invoice, InvoiceLineItem, SessionLog } from "../types/database";
import {
  aggregateReportSections, resolveReportSection,
  type ReportSection, type ReportRawLine, type PackageMeta,
} from "../utils/buildInvoicePdf";
import { isNonBillableNoShow } from "../utils/noShow";

export type InvoiceLineItemWithNames = InvoiceLineItem & {
  teachers: { first_name: string; last_name: string | null } | null;
  subjects:  { name: string; level: string | null } | null;
  curricula: { name: string } | null;
  program_types: { name: string } | null;
};

export type InvoiceWithItems = Invoice & {
  invoice_line_items: InvoiceLineItemWithNames[];
  invoice_packages: { student_package_id: number }[];
};

// Plain columns only — no embedded relations. session_logs has two FKs into
// teachers (teacher_id, coordinator_teacher_id), which makes PostgREST
// embedding (`teachers(...)`) ambiguous and fail; names are resolved
// client-side from already-loaded teacher/subject/curriculum lookups
// instead, mirroring the pattern useSessionLogs already uses successfully.
export type SessionLogDetailed = Pick<SessionLog,
  "id" | "session_date" | "session_duration_hrs" | "no_show_type" | "teacher_id" | "subject_id" | "curriculum_id" | "topic" | "course_type_id" | "program_type_id" | "student_package_id" | "video_link"
>;

export function useInvoices() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInvoicesForStudent = useCallback(async (studentId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select(`
        *,
        invoice_line_items(
          *,
          teachers(first_name, last_name),
          subjects(name, level),
          curricula(name),
          program_types(name)
        ),
        invoice_packages(student_package_id)
      `)
      .eq("student_id", studentId)
      .order("generated_at", { ascending: false });
    setLoading(false);
    if (error) { setError(error.message); return []; }
    setError(null);
    return (data ?? []) as InvoiceWithItems[];
  }, []);

  function buildLineItems(sessions: SessionLog[]) {
    const map = new Map<string, {
      teacher_id: string | null;
      subject_id: number | null;
      curriculum_id: number | null;
      student_package_id: number | null;
      course_type_id: number | null;
      program_type_id: number | null;
      hours: number;
      session_count: number;
      is_no_show: boolean;
    }>();
    for (const s of sessions) {
      if (isNonBillableNoShow(s.no_show_type)) continue;
      // Invoices are billable-only, matching how package hours accrue —
      // Demo Lessons/Offline Work never carry a course_type_id and never
      // deduct from a package, so they never appear on an invoice either.
      if (s.course_type_id == null) continue;
      // Only No Show + reaches here (No Show 1/2 were filtered out above as
      // non-billable) — it still deducts an hour, but never held an actual
      // session, so it's kept on its own line (never merged with a
      // completed-session line for the same teacher/subject) via is_no_show
      // in the key, letting reports show it as a distinct breakdown.
      const isNoShow = s.no_show_type != null;
      // Keyed by package/pool too, so each line item stays attributable to
      // the exact pool it deducted from (needed to section a report by
      // course type / bundle pool rather than by curriculum). Program type
      // is part of the key so subject-less rows (College Counselling /
      // College Essays) stay split by program instead of merging into one
      // anonymous "—" row.
      const key = `${s.student_package_id ?? ""}|${s.course_type_id ?? ""}|${s.teacher_id ?? ""}|${s.subject_id ?? ""}|${s.curriculum_id ?? ""}|${s.program_type_id ?? ""}|${isNoShow}`;
      const existing = map.get(key);
      if (existing) {
        existing.hours += s.session_duration_hrs ?? 0;
        existing.session_count += 1;
      } else {
        map.set(key, {
          teacher_id:   s.teacher_id,
          subject_id:   s.subject_id,
          curriculum_id: s.curriculum_id,
          student_package_id: s.student_package_id ?? null,
          course_type_id: s.course_type_id,
          program_type_id: s.program_type_id ?? null,
          hours:        s.session_duration_hrs ?? 0,
          session_count: 1,
          is_no_show: isNoShow,
        });
      }
    }
    return Array.from(map.values());
  }

  async function insertInvoiceFromSessions(opts: {
    studentId: string;
    periodStart: string;
    periodEnd: string;
    generatedByUserId: string;
    sessionList: SessionLog[];
    packageIds?: number[];
  }) {
    const lineItems = buildLineItems(opts.sessionList);
    const totalHours = lineItems.reduce((sum, li) => sum + li.hours, 0);

    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert({
        student_id:            opts.studentId,
        period_start:          opts.periodStart,
        period_end:            opts.periodEnd,
        generated_by_user_id:  opts.generatedByUserId,
        total_hours:           totalHours,
      })
      .select()
      .single();

    if (invErr || !inv) return { data: null, error: invErr?.message ?? "Failed to create invoice" };

    if (lineItems.length > 0) {
      const { error: liErr } = await supabase
        .from("invoice_line_items")
        .insert(lineItems.map((li) => ({ ...li, invoice_id: (inv as Invoice).id })));
      if (liErr) return { data: null, error: liErr.message };
    }

    if (opts.packageIds && opts.packageIds.length > 0) {
      const { error: ipErr } = await supabase
        .from("invoice_packages")
        .insert(opts.packageIds.map((pid) => ({ invoice_id: (inv as Invoice).id, student_package_id: pid })));
      if (ipErr) return { data: null, error: ipErr.message };
    }

    return { data: inv as Invoice, error: null };
  }

  const generateInvoice = useCallback(async (opts: {
    studentId: string;
    periodStart: string;
    periodEnd: string;
    generatedByUserId: string;
  }) => {
    setLoading(true);
    const { data: sessions, error: sessErr } = await supabase
      .from("session_logs")
      .select("*")
      .eq("student_id", opts.studentId)
      .gte("session_date", opts.periodStart)
      .lte("session_date", opts.periodEnd);

    if (sessErr) { setLoading(false); return { data: null, error: sessErr.message }; }

    const result = await insertInvoiceFromSessions({
      studentId: opts.studentId,
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      generatedByUserId: opts.generatedByUserId,
      sessionList: (sessions ?? []) as SessionLog[],
    });
    setLoading(false);
    if (!result.error) setError(null);
    return result;
  }, []);

  // Generates a single invoice covering the full session history of one or
  // more packages — e.g. just "Academic", or a whole Foundation Program /
  // All-In-One bundle (all its pools at once). Matching is primarily by
  // `student_package_id` (each session records the exact pool it deducted
  // from), which is what makes a bundle report cover precisely its own pools
  // rather than every session that merely shares a course_type — e.g. an
  // All-In-One bundle's four Beyond Academic pools all share course_type_id
  // = Beyond Academic, so course_type matching alone can't tell them apart
  // or separate them from an unrelated Beyond Academic package. Legacy
  // sessions predating the `student_package_id` column fall back to
  // course_type matching so they aren't silently dropped.
  const generateInvoiceForPackages = useCallback(async (opts: {
    studentId: string;
    generatedByUserId: string;
    // `createdAt` is the package's added date (its `created_at`) — used as the
    // report's start date so the period runs from when the package was added,
    // not from its first session.
    packages: { id: number; courseTypeId: number; createdAt?: string }[];
  }) => {
    setLoading(true);
    const { data: sessions, error: sessErr } = await supabase
      .from("session_logs")
      .select("*")
      .eq("student_id", opts.studentId);

    if (sessErr) { setLoading(false); return { data: null, error: sessErr.message }; }

    const allSessions = (sessions ?? []) as SessionLog[];
    const packageIds = new Set(opts.packages.map((p) => p.id));
    const courseTypeIds = new Set(opts.packages.map((p) => p.courseTypeId));
    const matching = allSessions.filter((s) => {
      if (isNonBillableNoShow(s.no_show_type) || s.course_type_id == null) return false;
      if (s.student_package_id != null) return packageIds.has(s.student_package_id);
      return courseTypeIds.has(s.course_type_id);
    });

    if (matching.length === 0) {
      setLoading(false);
      return { data: null, error: "No sessions found for the selected package(s)." };
    }

    const dates = matching.map((s) => s.session_date).sort();
    // Start date = the day the package was added (earliest package created_at
    // for a multi-pool bundle); end date = the last session logged for it.
    // Falls back to the first session date if no created_at was supplied.
    const createdDates = opts.packages
      .map((p) => (p.createdAt ? p.createdAt.slice(0, 10) : null))
      .filter((d): d is string => d != null)
      .sort();
    const periodStart = createdDates[0] ?? dates[0];
    const result = await insertInvoiceFromSessions({
      studentId: opts.studentId,
      periodStart,
      periodEnd: dates[dates.length - 1],
      generatedByUserId: opts.generatedByUserId,
      sessionList: matching,
      packageIds: opts.packages.map((p) => p.id),
    });
    setLoading(false);
    if (!result.error) setError(null);
    return result;
  }, []);

  // Fetches the full, detailed session log rows behind a package invoice
  // (same matching rules as generateInvoiceForPackages: by student_package_id
  // primarily, course_type_id as a legacy fallback) — used to download the
  // exact sessions behind a package invoice.
  const fetchSessionLogsForPackages = useCallback(async (opts: {
    studentId: string;
    packageIds: number[];
    courseTypeIds: number[];
  }) => {
    const { data, error } = await supabase
      .from("session_logs")
      .select("id, session_date, session_duration_hrs, no_show_type, teacher_id, subject_id, curriculum_id, topic, course_type_id, program_type_id, student_package_id, video_link")
      .eq("student_id", opts.studentId)
      .order("session_date", { ascending: false });
    if (error) return [];
    const all = (data ?? []) as unknown as SessionLogDetailed[];
    const packageIds = new Set(opts.packageIds);
    const courseTypeIds = new Set(opts.courseTypeIds);
    return all.filter((s) => {
      if (s.course_type_id == null) return false;
      if (s.student_package_id != null) return packageIds.has(s.student_package_id);
      return courseTypeIds.has(s.course_type_id);
    });
  }, []);

  // Fetches the full, detailed session log rows for a date range — used for
  // a date-range invoice (which has no package/allocation to scope to).
  const fetchSessionLogsForDateRange = useCallback(async (opts: {
    studentId: string;
    periodStart: string;
    periodEnd: string;
  }) => {
    const { data, error } = await supabase
      .from("session_logs")
      .select("id, session_date, session_duration_hrs, no_show_type, teacher_id, subject_id, curriculum_id, topic, course_type_id, program_type_id, video_link")
      .eq("student_id", opts.studentId)
      .gte("session_date", opts.periodStart)
      .lte("session_date", opts.periodEnd)
      .order("session_date", { ascending: false });
    if (error) return [];
    return (data ?? []) as unknown as SessionLogDetailed[];
  }, []);

  // Builds an invoice's report sections (course type / bundle pool → subject
  // → teacher) from its stored line items. `packageById` + `courseTypeName`
  // come from the caller's already-loaded lookups so a pool line resolves to
  // its pool label / bundle. Shared by the on-screen invoice list and the
  // downloaded PDF so the two can never disagree.
  function buildInvoiceSections(
    lineItems: InvoiceLineItemWithNames[],
    packageById: Map<number, PackageMeta>,
    courseTypeName: (id: number | null) => string,
  ): ReportSection[] {
    const rawLines: ReportRawLine[] = lineItems.map((li) => ({
      student_package_id: li.student_package_id,
      course_type_id: li.course_type_id,
      subject_id: li.subject_id,
      subjectName: li.subjects?.name ?? null,
      subjectLevel: li.subjects?.level ?? null,
      curriculumName: li.curricula?.name ?? null,
      program_type_id: li.program_type_id,
      programTypeName: li.program_types?.name ?? null,
      teacherName: li.teachers ? `${li.teachers.first_name} ${li.teachers.last_name ?? ""}`.trim() : "—",
      hours: li.hours,
      session_count: li.session_count,
      isNoShow: li.is_no_show,
    }));
    return aggregateReportSections(rawLines, (spid, ctid) => resolveReportSection(spid, ctid, packageById, courseTypeName));
  }

  const markInvoiceSent = useCallback(async (invoiceId: number) => {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "sent" })
      .eq("id", invoiceId);
    return { error: error?.message ?? null };
  }, []);

  // Locks an invoice (freezing it as final). Packages themselves never
  // close — hours just keep accumulating — so locking only freezes the
  // invoice record, with no side effect on the package(s) it covers.
  const lockInvoice = useCallback(async (opts: {
    invoiceId: number;
    lockedByUserId: string;
  }) => {
    const { error: invErr } = await supabase
      .from("invoices")
      .update({ status: "locked", locked_at: new Date().toISOString(), locked_by_user_id: opts.lockedByUserId })
      .eq("id", opts.invoiceId);
    if (invErr) return { error: invErr.message };
    return { error: null };
  }, []);

  // Publishes a report to the student's dashboard (or unpublishes it). A
  // report is a draft — admin/PC only — until this stamps
  // published_to_student_at; RLS then lets the student read it. Passing
  // publish=false clears it, hiding the report again.
  const setInvoicePublished = useCallback(async (opts: {
    invoiceId: number;
    publish: boolean;
    userId: string;
  }) => {
    const { error } = await supabase
      .from("invoices")
      .update(
        opts.publish
          ? { published_to_student_at: new Date().toISOString(), published_by_user_id: opts.userId }
          : { published_to_student_at: null, published_by_user_id: null }
      )
      .eq("id", opts.invoiceId);
    return { error: error?.message ?? null };
  }, []);

  // Deletes a draft invoice. Locked invoices are protected by a DB trigger
  // and cannot be deleted — only drafts (date-range or package) can be.
  const deleteInvoice = useCallback(async (invoiceId: number) => {
    const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
    return { error: error?.message ?? null };
  }, []);

  // Regenerates an existing DRAFT invoice's line items + totals IN PLACE from
  // the latest session data — no new invoice is created. Mirrors the monthly
  // report "refresh before lock" fix (see AdminReportsPage.startLockWithRefresh)
  // so a per-student report can never be locked with stale numbers: a report's
  // totals are snapshotted at generation, and Lock alone never re-pulls live
  // data, so sessions logged between generating and locking would otherwise be
  // dropped from the locked (payment) figures. A locked invoice is refused. A
  // date-range invoice keeps its fixed period and re-pulls sessions within it;
  // a package invoice re-matches its pools (same rules as
  // generateInvoiceForPackages) and re-derives period_end from the latest
  // matching session (period_start stays the package's added date).
  const regenerateInvoice = useCallback(async (opts: {
    invoice: InvoiceWithItems;
    // Package invoices only — the pools this invoice covers, with the same
    // metadata generateInvoiceForPackages needs (course type for the legacy
    // fallback, created_at for the period start). Omitted for a date-range one.
    packages?: { id: number; courseTypeId: number; createdAt?: string }[];
    generatedByUserId: string;
  }) => {
    const inv = opts.invoice;
    if (inv.status === "locked") {
      return { error: "This report is locked and can't be regenerated." };
    }
    setLoading(true);

    const isPackageInvoice = inv.invoice_packages.length > 0;

    const { data: sessions, error: sessErr } = await supabase
      .from("session_logs")
      .select("*")
      .eq("student_id", inv.student_id);
    if (sessErr) { setLoading(false); return { error: sessErr.message }; }
    const allSessions = (sessions ?? []) as SessionLog[];

    let sessionList: SessionLog[];
    let periodStart = inv.period_start;
    let periodEnd = inv.period_end;

    if (isPackageInvoice) {
      const pkgs = opts.packages ?? [];
      const packageIds = new Set(pkgs.map((p) => p.id));
      const courseTypeIds = new Set(pkgs.map((p) => p.courseTypeId));
      sessionList = allSessions.filter((s) => {
        if (isNonBillableNoShow(s.no_show_type) || s.course_type_id == null) return false;
        if (s.student_package_id != null) return packageIds.has(s.student_package_id);
        return courseTypeIds.has(s.course_type_id);
      });
      const dates = sessionList.map((s) => s.session_date).sort();
      const createdDates = pkgs
        .map((p) => (p.createdAt ? p.createdAt.slice(0, 10) : null))
        .filter((d): d is string => d != null)
        .sort();
      periodStart = createdDates[0] ?? dates[0] ?? inv.period_start;
      periodEnd = dates[dates.length - 1] ?? inv.period_end;
    } else {
      // Date-range invoice: fixed period, re-pull sessions within it.
      sessionList = allSessions.filter(
        (s) => s.session_date >= inv.period_start && s.session_date <= inv.period_end
      );
    }

    const lineItems = buildLineItems(sessionList);
    const totalHours = lineItems.reduce((sum, li) => sum + li.hours, 0);

    // Guarded to drafts — if it locked out from under us, refuse rather than
    // wipe a locked invoice's line items.
    const { data: updated, error: updErr } = await supabase
      .from("invoices")
      .update({
        total_hours: totalHours,
        period_start: periodStart,
        period_end: periodEnd,
        generated_at: new Date().toISOString(),
        generated_by_user_id: opts.generatedByUserId,
      })
      .eq("id", inv.id)
      .eq("status", "draft")
      .select()
      .maybeSingle();
    if (updErr) { setLoading(false); return { error: updErr.message }; }
    if (!updated) {
      setLoading(false);
      return { error: "This report is no longer a draft — refresh and try again." };
    }

    const { error: delErr } = await supabase.from("invoice_line_items").delete().eq("invoice_id", inv.id);
    if (delErr) { setLoading(false); return { error: delErr.message }; }

    if (lineItems.length > 0) {
      const { error: liErr } = await supabase
        .from("invoice_line_items")
        .insert(lineItems.map((li) => ({ ...li, invoice_id: inv.id })));
      if (liErr) { setLoading(false); return { error: liErr.message }; }
    }

    setLoading(false);
    setError(null);
    return { error: null };
  }, []);

  return {
    loading,
    error,
    fetchInvoicesForStudent,
    generateInvoice,
    generateInvoiceForPackages,
    fetchSessionLogsForPackages,
    fetchSessionLogsForDateRange,
    markInvoiceSent,
    lockInvoice,
    setInvoicePublished,
    deleteInvoice,
    regenerateInvoice,
    buildLineItems,
    buildInvoiceSections,
  };
}

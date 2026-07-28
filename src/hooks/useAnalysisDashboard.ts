import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { getCached, setCached } from "../lib/cache";
import { ENGAGEMENT_SCORE } from "../utils/engagementScore";
import {
  type DateRangePreset,
  DEFAULT_DATE_RANGE_PRESET,
  resolvePresetRange,
  pickGranularity,
  generateBucketKeys,
  bucketKeyForDate,
  bucketLabel,
  toISODate,
  type TrendGranularity,
} from "../utils/dateRangePresets";

export interface AnalysisFilters {
  preset: DateRangePreset;
  customFrom?: string;
  customTo?: string;
  teacherIds: number[];
  coordinatorIds: number[];
  countries: string[];
  studentIds: string[];
  noShowType?: "any" | "no_show_1" | "no_show_2" | "no_show_plus";
  flagged?: "yes" | "no";
  engagementRating?: "low" | "medium" | "high";
}

export function defaultAnalysisFilters(): AnalysisFilters {
  return {
    preset: DEFAULT_DATE_RANGE_PRESET,
    teacherIds: [],
    coordinatorIds: [],
    countries: [],
    studentIds: [],
  };
}

export function hasActiveFilters(f: AnalysisFilters): boolean {
  return (
    f.preset !== DEFAULT_DATE_RANGE_PRESET ||
    f.teacherIds.length > 0 ||
    f.coordinatorIds.length > 0 ||
    f.countries.length > 0 ||
    f.studentIds.length > 0 ||
    Boolean(f.noShowType) ||
    Boolean(f.flagged) ||
    Boolean(f.engagementRating)
  );
}

export interface TrendPoint {
  key: string;
  label: string;
  hours: number;
  sessions: number;
  noShowRate: number;
}

export interface NamedStat {
  name: string;
  hours: number;
  sessions: number;
}

export interface EntityStat {
  id: string;
  name: string;
  meta?: string;
  sessions: number;
  hours: number;
  noShowCount: number;
  noShowRate: number;
  flaggedCount: number;
  flaggedRate: number;
  avgEngagement: number | null;
}

export interface FilteredSessionRow {
  teacherId: number | null;
  coordinatorId: number | null;
  studentId: string | null;
  subjectId: number | null;
  programTypeId: number | null;
  date: string;
  hours: number;
  noShowType: string | null;
  engagementRating: "low" | "medium" | "high" | null;
  flagged: boolean;
  flagCategory: string | null;
}

export interface EnrollmentStats {
  newStudents: number;
  renewals: number;
  totalConfirmed: number;
  renewalRate: number;
  packagesSold: number;
  hoursSold: number;
}

function emptyEnrollmentStats(): EnrollmentStats {
  return { newStudents: 0, renewals: 0, totalConfirmed: 0, renewalRate: 0, packagesSold: 0, hoursSold: 0 };
}

export interface AnalysisDashboardData {
  totalHours: number;
  totalSessions: number;
  noShowCount: number;
  noShowRate: number;
  flaggedRate: number;
  activeTeachers: number;
  activeStudents: number;
  trend: TrendPoint[];
  trendGranularity: TrendGranularity;
  subjects: NamedStat[];
  programTypes: NamedStat[];
  engagement: NamedStat[];
  noShowTypes: NamedStat[];
  flagCategories: NamedStat[];
  geography: NamedStat[];
  teacherStats: EntityStat[];
  studentStats: EntityStat[];
  coordinatorStats: EntityStat[];
  enrollment: EnrollmentStats;
  rows: FilteredSessionRow[];
  teacherNameMap: Map<number, string>;
  studentNameMap: Map<string, string>;
}

function emptyDashboard(): AnalysisDashboardData {
  return {
    totalHours: 0,
    totalSessions: 0,
    noShowCount: 0,
    noShowRate: 0,
    flaggedRate: 0,
    activeTeachers: 0,
    activeStudents: 0,
    trend: [],
    trendGranularity: "month",
    subjects: [],
    programTypes: [],
    engagement: [],
    noShowTypes: [],
    flagCategories: [],
    geography: [],
    teacherStats: [],
    studentStats: [],
    coordinatorStats: [],
    enrollment: emptyEnrollmentStats(),
    rows: [],
    teacherNameMap: new Map(),
    studentNameMap: new Map(),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function nextDayISO(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return toISODate(d);
}

// New students / renewals / packages sold — driven purely by the active date
// range, independent of the Tutor/Student/PC/Country filters (which don't
// map onto enrollment_requests, an admin/PC-driven flow with no tutor and no
// per-session country of its own).
async function fetchEnrollmentStats(from: string | null, to: string): Promise<EnrollmentStats> {
  let query = supabase.from("enrollment_requests").select("id, enrollment_type").eq("status", "confirmed").lt("confirmed_at", nextDayISO(to));
  if (from) query = query.gte("confirmed_at", from);
  const { data: requests } = await query;
  if (!requests || requests.length === 0) return emptyEnrollmentStats();

  const newStudents = requests.filter((r) => r.enrollment_type === "new_student").length;
  const renewals = requests.filter((r) => r.enrollment_type === "renewal").length;
  const totalConfirmed = requests.length;
  const renewalRate = totalConfirmed > 0 ? round1((renewals / totalConfirmed) * 100) : 0;

  const ids = requests.map((r) => r.id as string);
  const { data: packages } = await supabase.from("enrollment_request_packages").select("hours").in("enrollment_request_id", ids);
  const packagesSold = packages?.length ?? 0;
  const hoursSold = round1((packages ?? []).reduce((a, p) => a + ((p.hours as number) ?? 0), 0));

  return { newStudents, renewals, totalConfirmed, renewalRate, packagesSold, hoursSold };
}

function bucketBy(rows: { key: string | number | null; hours: number }[], nameMap: Map<string | number, string>): NamedStat[] {
  const map = new Map<string, NamedStat>();
  for (const r of rows) {
    const name = (r.key !== null ? nameMap.get(r.key) : null) ?? "Unknown";
    if (!map.has(name)) map.set(name, { name, hours: 0, sessions: 0 });
    const s = map.get(name)!;
    s.hours += r.hours;
    s.sessions += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.hours - a.hours);
}

interface EntityAccumulator {
  sessions: number;
  hours: number;
  noShow: number;
  flagged: number;
  engagementSum: number;
  engagementCount: number;
  total: number;
}

function computeEntityStats(
  rows: FilteredSessionRow[],
  keyFn: (r: FilteredSessionRow) => string | number | null,
  nameFn: (key: string) => string,
  metaFn?: (key: string) => string | undefined
): EntityStat[] {
  const map = new Map<string, EntityAccumulator>();
  for (const r of rows) {
    const key = keyFn(r);
    if (key === null) continue;
    const k = String(key);
    if (!map.has(k)) map.set(k, { sessions: 0, hours: 0, noShow: 0, flagged: 0, engagementSum: 0, engagementCount: 0, total: 0 });
    const s = map.get(k)!;
    s.total += 1;
    if (r.noShowType !== null) {
      s.noShow += 1;
    } else {
      s.sessions += 1;
      s.hours += r.hours;
      if (r.flagged) s.flagged += 1;
      if (r.engagementRating) {
        s.engagementSum += ENGAGEMENT_SCORE[r.engagementRating] ?? 0;
        s.engagementCount += 1;
      }
    }
  }
  const result: EntityStat[] = [];
  for (const [k, s] of map) {
    result.push({
      id: k,
      name: nameFn(k),
      meta: metaFn?.(k),
      sessions: s.sessions,
      hours: round1(s.hours),
      noShowCount: s.noShow,
      noShowRate: s.total > 0 ? round1((s.noShow / s.total) * 100) : 0,
      flaggedCount: s.flagged,
      flaggedRate: s.sessions > 0 ? round1((s.flagged / s.sessions) * 100) : 0,
      avgEngagement: s.engagementCount > 0 ? round1(s.engagementSum / s.engagementCount) : null,
    });
  }
  return result;
}

function ensureIncluded(
  stats: EntityStat[],
  ids: (string | number)[],
  nameFn: (key: string) => string,
  metaFn?: (key: string) => string | undefined
): EntityStat[] {
  const existing = new Set(stats.map((s) => s.id));
  const extra: EntityStat[] = [];
  for (const id of ids) {
    const k = String(id);
    if (!existing.has(k)) {
      extra.push({
        id: k,
        name: nameFn(k),
        meta: metaFn?.(k),
        sessions: 0,
        hours: 0,
        noShowCount: 0,
        noShowRate: 0,
        flaggedCount: 0,
        flaggedRate: 0,
        avgEngagement: null,
      });
    }
  }
  return [...stats, ...extra];
}

function filtersKey(filters: AnalysisFilters): string {
  return `analysisDashboard:${JSON.stringify(filters)}`;
}

async function fetchDashboard(filters: AnalysisFilters): Promise<{ data: AnalysisDashboardData; error?: string }> {
  const { from, to } = resolvePresetRange(filters.preset, filters.customFrom, filters.customTo);

  // Independent of every other filter below — enrollment_requests has no
  // tutor/PC and no per-request country, so this only ever tracks the date range.
  const enrollmentStats = await fetchEnrollmentStats(from, to);

  // Country filter has no column on session_logs — resolve it to a set of
  // student ids first, intersected with any explicit student selection.
  let effectiveStudentIds: string[] | null = null;
  if (filters.countries.length > 0) {
    const { data, error } = await supabase.from("students").select("id").in("country", filters.countries);
    if (error) return { data: emptyDashboard(), error: error.message };
    const countryIds = new Set((data ?? []).map((s) => s.id as string));
    effectiveStudentIds =
      filters.studentIds.length > 0 ? filters.studentIds.filter((id) => countryIds.has(id)) : Array.from(countryIds);
  } else if (filters.studentIds.length > 0) {
    effectiveStudentIds = filters.studentIds;
  }

  if (effectiveStudentIds !== null && effectiveStudentIds.length === 0) {
    return { data: { ...emptyDashboard(), enrollment: enrollmentStats } };
  }

  let query = supabase
    .from("session_logs")
    .select(
      "teacher_id, coordinator_teacher_id, subject_id, program_type_id, student_id, session_date, session_duration_hrs, no_show_type, engagement_rating, flag_for_coach, flag_category"
    );

  if (from) query = query.gte("session_date", from);
  query = query.lte("session_date", to);
  if (filters.teacherIds.length > 0) query = query.in("teacher_id", filters.teacherIds);
  if (filters.coordinatorIds.length > 0) query = query.in("coordinator_teacher_id", filters.coordinatorIds);
  if (effectiveStudentIds) query = query.in("student_id", effectiveStudentIds);
  if (filters.noShowType === "any") {
    query = query.not("no_show_type", "is", null);
  } else if (filters.noShowType) {
    query = query.eq("no_show_type", filters.noShowType);
  }
  if (filters.flagged === "yes") query = query.eq("flag_for_coach", true);
  else if (filters.flagged === "no") query = query.eq("flag_for_coach", false);
  if (filters.engagementRating) query = query.eq("engagement_rating", filters.engagementRating);

  const [sessionsRes, teachersRes, subjectsRes, programTypesRes, studentsRes] = await Promise.all([
    query,
    supabase.from("teachers").select("id, first_name, last_name, country"),
    supabase.from("subjects").select("id, name"),
    supabase.from("program_types").select("id, name"),
    supabase.from("students").select("id, first_name, last_name, country"),
  ]);

  if (sessionsRes.error) return { data: { ...emptyDashboard(), enrollment: enrollmentStats }, error: sessionsRes.error.message };

  const teacherNameMap = new Map<number, string>(
    (teachersRes.data ?? []).map((t) => [t.id as number, `${t.first_name} ${t.last_name ?? ""}`.trim()])
  );
  const teacherCountryMap = new Map<number, string>(
    (teachersRes.data ?? []).map((t) => [t.id as number, (t.country as string | null) ?? "Unknown"])
  );
  const subjectNameMap = new Map<string | number, string>((subjectsRes.data ?? []).map((s) => [s.id as number, s.name as string]));
  const programNameMap = new Map<string | number, string>((programTypesRes.data ?? []).map((p) => [p.id as number, p.name as string]));
  const studentNameMap = new Map<string, string>(
    (studentsRes.data ?? []).map((s) => [s.id as string, `${s.id} — ${s.first_name} ${s.last_name}`])
  );
  const studentCountryMap = new Map<string, string>(
    (studentsRes.data ?? []).map((s) => [s.id as string, (s.country as string | null) ?? "Unknown"])
  );

  const rows: FilteredSessionRow[] = (sessionsRes.data ?? []).map((r) => ({
    teacherId: r.teacher_id as number | null,
    coordinatorId: r.coordinator_teacher_id as number | null,
    studentId: r.student_id as string | null,
    subjectId: r.subject_id as number | null,
    programTypeId: r.program_type_id as number | null,
    date: r.session_date as string,
    hours: (r.session_duration_hrs as number) ?? 0,
    noShowType: r.no_show_type as string | null,
    engagementRating: r.engagement_rating as "low" | "medium" | "high" | null,
    flagged: Boolean(r.flag_for_coach),
    flagCategory: r.flag_category as string | null,
  }));

  const taught = rows.filter((r) => r.noShowType === null);
  const noShows = rows.filter((r) => r.noShowType !== null);

  // --- Trend chart: adaptive granularity based on the active range's span ---
  const toDate = new Date(`${to}T00:00:00`);
  let fromDate: Date | null = from ? new Date(`${from}T00:00:00`) : null;
  if (!fromDate && rows.length > 0) {
    const minDate = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
    fromDate = new Date(`${minDate}T00:00:00`);
  }
  const trendGranularity = pickGranularity(fromDate, toDate);
  let trend: TrendPoint[] = [];
  if (fromDate) {
    const keys = generateBucketKeys(fromDate, toDate, trendGranularity);
    const bucketMap = new Map<string, TrendPoint>();
    for (const k of keys) bucketMap.set(k, { key: k, label: bucketLabel(k, trendGranularity), hours: 0, sessions: 0, noShowRate: 0 });
    const totalCounts = new Map<string, number>();
    const noShowCounts = new Map<string, number>();
    for (const r of rows) {
      const k = bucketKeyForDate(new Date(`${r.date}T00:00:00`), trendGranularity);
      totalCounts.set(k, (totalCounts.get(k) ?? 0) + 1);
      if (r.noShowType !== null) {
        noShowCounts.set(k, (noShowCounts.get(k) ?? 0) + 1);
      } else if (bucketMap.has(k)) {
        const b = bucketMap.get(k)!;
        b.hours += r.hours;
        b.sessions += 1;
      }
    }
    for (const [k, b] of bucketMap) {
      const total = totalCounts.get(k) ?? 0;
      const ns = noShowCounts.get(k) ?? 0;
      b.noShowRate = total > 0 ? round1((ns / total) * 100) : 0;
      b.hours = round1(b.hours);
    }
    trend = Array.from(bucketMap.values());
  }

  const totalHours = round1(taught.reduce((a, r) => a + r.hours, 0));
  const totalSessions = taught.length;
  const noShowCount = noShows.length;
  const noShowRate = rows.length > 0 ? round1((noShowCount / rows.length) * 100) : 0;
  const flaggedCount = taught.filter((r) => r.flagged).length;
  const flaggedRate = totalSessions > 0 ? round1((flaggedCount / totalSessions) * 100) : 0;
  const activeTeachers = new Set(taught.map((r) => r.teacherId).filter((v): v is number => v !== null)).size;
  const activeStudents = new Set(taught.map((r) => r.studentId).filter((v): v is string => v !== null)).size;

  const subjects = bucketBy(
    taught.map((r) => ({ key: r.subjectId, hours: r.hours })),
    subjectNameMap
  ).slice(0, 8);

  const programTypes = bucketBy(
    taught.map((r) => ({ key: r.programTypeId, hours: r.hours })),
    programNameMap
  ).slice(0, 8);

  const engagementMap = new Map<string | number, string>([
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
  ]);
  const engagement = bucketBy(
    taught.filter((r) => r.engagementRating).map((r) => ({ key: r.engagementRating as string, hours: 0 })),
    engagementMap
  );

  const noShowLabelMap = new Map<string | number, string>([
    ["no_show_1", "No-show (1st)"],
    ["no_show_2", "No-show (2nd)"],
    ["no_show_plus", "No-show (3rd+)"],
  ]);
  const noShowTypes = bucketBy(
    noShows.map((r) => ({ key: r.noShowType as string, hours: 0 })),
    noShowLabelMap
  );

  const flagNameMap = new Map<string | number, string>();
  const flagCategories = bucketBy(
    taught
      .filter((r) => r.flagged)
      .map((r) => {
        const cat = r.flagCategory ?? "Uncategorized";
        flagNameMap.set(cat, cat);
        return { key: cat, hours: 0 };
      }),
    flagNameMap
  );

  const geoNameMap = new Map<string | number, string>();
  const geography = bucketBy(
    taught.map((r) => {
      const country = r.studentId ? studentCountryMap.get(r.studentId) ?? "Unknown" : "Unknown";
      geoNameMap.set(country, country);
      return { key: country, hours: r.hours };
    }),
    geoNameMap
  ).slice(0, 8);

  let teacherStats = computeEntityStats(
    rows,
    (r) => r.teacherId,
    (id) => teacherNameMap.get(Number(id)) ?? "Unknown",
    (id) => teacherCountryMap.get(Number(id))
  );
  teacherStats = ensureIncluded(
    teacherStats,
    filters.teacherIds,
    (id) => teacherNameMap.get(Number(id)) ?? "Unknown",
    (id) => teacherCountryMap.get(Number(id))
  ).sort((a, b) => b.hours - a.hours);

  let studentStats = computeEntityStats(
    rows,
    (r) => r.studentId,
    (id) => studentNameMap.get(id) ?? id,
    (id) => studentCountryMap.get(id)
  );
  studentStats = ensureIncluded(
    studentStats,
    filters.studentIds,
    (id) => studentNameMap.get(id) ?? id,
    (id) => studentCountryMap.get(id)
  ).sort((a, b) => b.hours - a.hours);

  let coordinatorStats = computeEntityStats(
    rows,
    (r) => r.coordinatorId,
    (id) => teacherNameMap.get(Number(id)) ?? "Unknown"
  );
  coordinatorStats = ensureIncluded(coordinatorStats, filters.coordinatorIds, (id) => teacherNameMap.get(Number(id)) ?? "Unknown").sort(
    (a, b) => b.sessions + b.noShowCount - (a.sessions + a.noShowCount)
  );

  return {
    data: {
      totalHours,
      totalSessions,
      noShowCount,
      noShowRate,
      flaggedRate,
      activeTeachers,
      activeStudents,
      trend,
      trendGranularity,
      subjects,
      programTypes,
      engagement,
      noShowTypes,
      flagCategories,
      geography,
      teacherStats,
      studentStats,
      coordinatorStats,
      enrollment: enrollmentStats,
      rows,
      teacherNameMap,
      studentNameMap,
    },
  };
}

export function useAnalysisDashboard(filters: AnalysisFilters) {
  const [data, setData] = useState<AnalysisDashboardData>(emptyDashboard());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const key = filtersKey(filters);
    const cached = getCached<AnalysisDashboardData>(key);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(undefined);
      return;
    }
    setLoading(true);
    const { data: d, error: err } = await fetchDashboard(filters);
    if (!err) setCached(key, d);
    setData(d);
    setError(err);
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

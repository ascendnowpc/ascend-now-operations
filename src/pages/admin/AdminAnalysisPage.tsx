import { useState, useMemo, useEffect } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { Button } from "../../components/ui/Button";
import { SelectInput } from "../../components/ui/Input";
import { MultiSelect } from "../../components/ui/MultiSelect";
import { EntityStatsTable } from "../../components/analysis/EntityStatsTable";
import { useTeachers } from "../../hooks/useTeachers";
import { useStudents } from "../../hooks/useStudents";
import {
  useAnalysisDashboard,
  defaultAnalysisFilters,
  hasActiveFilters,
  type AnalysisFilters,
  type NamedStat,
  type TrendPoint,
} from "../../hooks/useAnalysisDashboard";
import { DATE_RANGE_PRESET_OPTIONS, type DateRangePreset } from "../../utils/dateRangePresets";
import { NO_SHOW_OPTIONS } from "../../utils/sessionLogDisplay";
import { ENGAGEMENT_SCORE, engagementLabel } from "../../utils/engagementScore";

const COLORS = ["#0ea5e9", "#84cc16", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#64748b"];

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-5">
      <p className="text-2xl font-bold text-navy-700">{value}</p>
      <p className="text-xs text-sky-500 font-semibold mt-1">{label}</p>
      <p className="text-xs text-navy-400 mt-0.5">{sub}</p>
    </Card>
  );
}

function TrendCard({ title, dataKey, color, suffix, data }: { title: string; dataKey: keyof TrendPoint; color: string; suffix: string; data: TrendPoint[] }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-navy-300 py-16 text-center">No data</p>
      ) : (
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ left: 0, right: 10, top: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `${v}${suffix}`} />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function DonutCard({ title, data }: { title: string; data: NamedStat[] }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-navy-300 py-10 text-center">No data</p>
      ) : (
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="sessions" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function BarCard({ title, data, dataKey, color }: { title: string; data: NamedStat[]; dataKey: "hours" | "sessions"; color: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-navy-300 py-10 text-center">No data</p>
      ) : (
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ left: 0, right: 10, top: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-navy-50/60 px-3 py-2">
      <p className="text-sm font-bold text-navy-700">{value}</p>
      <p className="text-xs text-navy-400">{label}</p>
    </div>
  );
}

function granularityWord(g: string) {
  return g === "day" ? "Day" : g === "week" ? "Week" : "Month";
}

function buildInsight(data: ReturnType<typeof useAnalysisDashboard>["data"]): string {
  if (data.totalSessions === 0) return "No sessions match the current filters.";
  const topSubject = data.subjects[0];
  const topTeacher = [...data.teacherStats].sort((a, b) => b.hours - a.hours)[0];
  const worstNoShow = [...data.teacherStats].filter((t) => t.sessions + t.noShowCount >= 3).sort((a, b) => b.noShowRate - a.noShowRate)[0];
  const parts: string[] = [];
  if (topSubject) parts.push(`"${topSubject.name}" was the most-taught subject (${round1(topSubject.hours)} hrs)`);
  if (topTeacher) parts.push(`${topTeacher.name} delivered the most hours (${round1(topTeacher.hours)} hrs)`);
  parts.push(`no-show rate was ${data.noShowRate}%`);
  if (data.flaggedRate > 0) parts.push(`${data.flaggedRate}% of sessions were flagged for the performance coach`);
  if (worstNoShow && worstNoShow.noShowRate > 0) parts.push(`${worstNoShow.name} had the highest no-show rate (${worstNoShow.noShowRate}%)`);
  return `Over this period: ${parts.join("; ")}.`;
}

export default function AdminAnalysisPage() {
  const [filters, setFilters] = useState<AnalysisFilters>(defaultAnalysisFilters());
  const [drilldownStudentId, setDrilldownStudentId] = useState<string>("");
  const { data, loading, error, reload } = useAnalysisDashboard(filters);
  const { teachers } = useTeachers();
  const { students } = useStudents();

  const tutorOptions = useMemo(
    () => teachers.map((t) => ({ value: String(t.id), label: `${t.first_name} ${t.last_name ?? ""}`.trim() })),
    [teachers]
  );
  const pcOptions = useMemo(
    () =>
      teachers
        .filter((t) => t.is_performance_coach)
        .map((t) => ({ value: String(t.id), label: `${t.first_name} ${t.last_name ?? ""}`.trim() })),
    [teachers]
  );
  const countryOptions = useMemo(() => {
    const set = new Set(students.map((s) => s.country).filter((c): c is string => Boolean(c)));
    return Array.from(set)
      .sort()
      .map((c) => ({ value: c, label: c }));
  }, [students]);
  const studentOptions = useMemo(
    () => students.map((s) => ({ value: s.id, label: `${s.id} — ${s.first_name} ${s.last_name}` })),
    [students]
  );

  const studentsInView = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of data.rows) {
      if (r.studentId && !seen.has(r.studentId)) {
        seen.set(r.studentId, data.studentNameMap.get(r.studentId) ?? r.studentId);
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data.rows, data.studentNameMap]);

  useEffect(() => {
    if (drilldownStudentId && !studentsInView.some((o) => o.value === drilldownStudentId)) {
      setDrilldownStudentId("");
    }
  }, [studentsInView, drilldownStudentId]);

  const engagementSeries = useMemo(() => {
    if (!drilldownStudentId) return [];
    return data.rows
      .filter((r) => r.studentId === drilldownStudentId && r.noShowType === null && r.engagementRating)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        label: new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }),
        score: ENGAGEMENT_SCORE[r.engagementRating as string],
      }));
  }, [data.rows, drilldownStudentId]);

  const drilldownStats = useMemo(
    () => data.studentStats.find((s) => s.id === drilldownStudentId) ?? null,
    [data.studentStats, drilldownStudentId]
  );

  function clearFilters() {
    setFilters(defaultAnalysisFilters());
  }

  return (
    <AdminLayout>
      <PageHeader
        title="Analysis"
        description="A live, filterable breakdown of session activity — tutors, students, PCs, countries, no-shows, flags, and engagement."
      />

      <Card className="p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 items-end">
          <SelectInput
            label="Date range"
            value={filters.preset}
            onChange={(e) => setFilters((f) => ({ ...f, preset: e.target.value as DateRangePreset }))}
            options={DATE_RANGE_PRESET_OPTIONS}
          />
          {filters.preset === "custom" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-navy-700">From date</label>
                <input
                  type="date"
                  value={filters.customFrom ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, customFrom: e.target.value || undefined }))}
                  className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-navy-700">To date</label>
                <input
                  type="date"
                  value={filters.customTo ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, customTo: e.target.value || undefined }))}
                  className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
            </>
          )}
          <MultiSelect
            label="Tutors"
            placeholder="All tutors"
            options={tutorOptions}
            selected={filters.teacherIds.map(String)}
            onChange={(vals) => setFilters((f) => ({ ...f, teacherIds: vals.map(Number) }))}
          />
          <MultiSelect
            label="Performance Coach"
            placeholder="All PCs"
            options={pcOptions}
            selected={filters.coordinatorIds.map(String)}
            onChange={(vals) => setFilters((f) => ({ ...f, coordinatorIds: vals.map(Number) }))}
          />
          <MultiSelect
            label="Countries"
            placeholder="All countries"
            options={countryOptions}
            selected={filters.countries}
            onChange={(vals) => setFilters((f) => ({ ...f, countries: vals }))}
          />
          <MultiSelect
            label="Students"
            placeholder="All students"
            options={studentOptions}
            selected={filters.studentIds}
            onChange={(vals) => setFilters((f) => ({ ...f, studentIds: vals }))}
          />
          <SelectInput
            label="No Show"
            placeholder="All sessions"
            value={filters.noShowType ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, noShowType: e.target.value ? (e.target.value as AnalysisFilters["noShowType"]) : undefined }))}
            options={NO_SHOW_OPTIONS}
          />
          <SelectInput
            label="Flag"
            placeholder="All"
            value={filters.flagged ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, flagged: e.target.value ? (e.target.value as "yes" | "no") : undefined }))}
            options={[
              { value: "yes", label: "Flagged" },
              { value: "no", label: "Not flagged" },
            ]}
          />
          <SelectInput
            label="Engagement"
            placeholder="All levels"
            value={filters.engagementRating ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, engagementRating: e.target.value ? (e.target.value as "low" | "medium" | "high") : undefined }))
            }
            options={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-navy-300">{hasActiveFilters(filters) ? "Filters active — every section below reflects this selection." : "Showing the default last 6 months."}</p>
          <Button size="sm" variant="ghost" onClick={clearFilters} disabled={!hasActiveFilters(filters)}>
            Clear filters
          </Button>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm">
          <Spinner /> Loading…
        </div>
      ) : error ? (
        <Card className="p-6">
          <p className="text-sm text-red-600">Error loading data: {error}</p>
          <button onClick={reload} className="mt-2 text-sm text-sky-500 hover:text-sky-700">
            Retry
          </button>
        </Card>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-3">Overview</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard label="Total Hours" value={`${data.totalHours}`} sub="hrs delivered" />
              <KpiCard label="Sessions" value={`${data.totalSessions}`} sub="logged" />
              <KpiCard label="No-show Rate" value={`${data.noShowRate}%`} sub={`${data.noShowCount} no-shows`} />
              <KpiCard label="Flagged" value={`${data.flaggedRate}%`} sub="for performance coach" />
              <KpiCard label="Active Tutors" value={`${data.activeTeachers}`} sub="taught a session" />
              <KpiCard label="Active Students" value={`${data.activeStudents}`} sub="had a session" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-3">Trends</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TrendCard title={`Hours by ${granularityWord(data.trendGranularity)}`} dataKey="hours" color="#0ea5e9" suffix=" hrs" data={data.trend} />
              <TrendCard title={`Sessions by ${granularityWord(data.trendGranularity)}`} dataKey="sessions" color="#84cc16" suffix="" data={data.trend} />
              <TrendCard title={`No-show Rate by ${granularityWord(data.trendGranularity)}`} dataKey="noShowRate" color="#ef4444" suffix="%" data={data.trend} />
            </div>
            <Card className="p-5 bg-sky-50 border border-sky-100 mt-4">
              <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide mb-1">Written analysis</p>
              <p className="text-sm text-navy-700">{buildInsight(data)}</p>
            </Card>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-3">Breakdown</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BarCard title="Subjects Taught (hours)" data={data.subjects} dataKey="hours" color="#0ea5e9" />
              <BarCard title="Program Types (hours)" data={data.programTypes} dataKey="hours" color="#8b5cf6" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <DonutCard title="Engagement Rating" data={data.engagement} />
              <DonutCard title="No-show Type" data={data.noShowTypes} />
              <DonutCard title="Flag Category" data={data.flagCategories} />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-1">Enrollment &amp; Packages</h2>
            <p className="text-xs text-navy-400 mb-3">Reflects the date range only — new-student and renewal confirmations don't have a tutor, PC, or student of their own to filter by.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <KpiCard label="New Students" value={`${data.enrollment.newStudents}`} sub="confirmed enrollments" />
              <KpiCard label="Renewals" value={`${data.enrollment.renewals}`} sub="confirmed renewals" />
              <KpiCard label="Renewal Rate" value={`${data.enrollment.renewalRate}%`} sub="of confirmed enrollments" />
              <KpiCard label="Packages Sold" value={`${data.enrollment.packagesSold}`} sub="package line items" />
              <KpiCard label="Hours Sold" value={`${data.enrollment.hoursSold}`} sub="hrs across new packages" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-1">Rankings &amp; Comparison</h2>
            <p className="text-xs text-navy-400 mb-3">Narrow the Tutors/Students/PC filters above to compare specific ones side by side.</p>
            <div className="space-y-4">
              <EntityStatsTable
                title="Tutor Performance"
                subtitle="Sort by any column — e.g. No-shows to compare tutors on no-show rate, Flagged on flag rate."
                rows={data.teacherStats}
                metaLabel="Country"
                defaultSortKey="hours"
              />
              <EntityStatsTable
                title="Student Performance"
                subtitle="Sort by No-shows or Flagged to see which students no-show or get flagged most."
                rows={data.studentStats}
                metaLabel="Country"
                defaultSortKey="hours"
              />
              <EntityStatsTable
                title="Performance Coach Performance"
                subtitle="Sessions coordinated per Performance Coach, with the no-show and flag rates of those sessions."
                rows={data.coordinatorStats}
                defaultSortKey="sessions"
              />
            </div>
          </section>

          {/* Student engagement drill-down */}
          <Card className="p-5">
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1">Student Engagement Trend</p>
            <p className="text-xs text-navy-400 mb-3">Pick a student to see how their engagement rating moved over time within the current filters.</p>
            {studentsInView.length === 0 ? (
              <p className="text-sm text-navy-300 py-10 text-center">No students in the current filters.</p>
            ) : (
              <>
                <div className="max-w-sm mb-3">
                  <SelectInput
                    label="Student"
                    placeholder="Choose a student…"
                    value={drilldownStudentId}
                    onChange={(e) => setDrilldownStudentId(e.target.value)}
                    options={studentsInView}
                  />
                </div>
                {!drilldownStudentId ? (
                  <p className="text-sm text-navy-300 py-10 text-center">Select a student above to see their engagement trend.</p>
                ) : engagementSeries.length === 0 ? (
                  <p className="text-sm text-navy-300 py-10 text-center">No engagement ratings recorded for this student in the selected period.</p>
                ) : (
                  <>
                    <div style={{ width: "100%", height: 220 }}>
                      <ResponsiveContainer>
                        <LineChart data={engagementSeries} margin={{ left: 0, right: 10, top: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis domain={[1, 3]} ticks={[1, 2, 3]} tickFormatter={(v) => (v === 1 ? "Low" : v === 2 ? "Medium" : "High")} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => (v === 1 ? "Low" : v === 2 ? "Medium" : "High")} />
                          <Line type="monotone" dataKey="score" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {drilldownStats && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                        <MiniStat label="Sessions" value={String(drilldownStats.sessions)} />
                        <MiniStat label="No-shows" value={`${drilldownStats.noShowCount} (${drilldownStats.noShowRate}%)`} />
                        <MiniStat label="Flagged" value={`${drilldownStats.flaggedCount} (${drilldownStats.flaggedRate}%)`} />
                        <MiniStat label="Avg Engagement" value={engagementLabel(drilldownStats.avgEngagement)} />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </Card>

          <section>
            <h2 className="text-sm font-semibold text-navy-500 uppercase tracking-wide mb-3">Geography</h2>
            <BarCard title="Sessions by Student Country (hours)" data={data.geography} dataKey="hours" color="#14b8a6" />
          </section>
        </div>
      )}
    </AdminLayout>
  );
}

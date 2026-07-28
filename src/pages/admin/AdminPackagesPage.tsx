import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { useAuth } from "../../context/AuthContext";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import { useStudentPackages } from "../../hooks/useStudentPackages";
import type { PackageTopup, Student, StudentPackage } from "../../types/database";
import { supabase } from "../../lib/supabaseClient";
import { formatHours } from "../../utils/formatHours";

const PROGRAM_TYPE_TO_COURSE_TYPE_NAME: Record<string, string> = {
  academic: "Academic",
  beyond_academic: "Beyond Academic",
};

type PackageWithTopups = StudentPackage & { package_topups: PackageTopup[] };
type StudentRow = Student & { packages: PackageWithTopups[] };

function courseTypeBadge(color: string | null) {
  switch (color) {
    case "green":  return "bg-green-100 text-green-700 border-green-200";
    case "orange": return "bg-orange-100 text-orange-700 border-orange-200";
    case "purple": return "bg-purple-100 text-purple-700 border-purple-200";
    case "sky":    return "bg-sky-100 text-sky-700 border-sky-200";
    case "amber":  return "bg-amber-100 text-amber-700 border-amber-200";
    case "navy":   return "bg-navy-50 text-navy-600 border-navy-100";
    default:       return "bg-navy-50 text-navy-600 border-navy-100";
  }
}

function BalanceBar({ used, total }: { used: number; total: number }) {
  // A package can have 0 purchased hours (e.g. the zero-hour pool
  // auto-created when a session is logged with no matching package at
  // all) yet still have used hours logged against it — an overage from
  // the moment it exists. Treat that as a full (red) bar rather than 0%.
  const rawPct = total > 0 ? used / total : used > 0 ? 1 : 0;
  const pct = Math.min(rawPct, 1);
  const fill = pct >= 0.9 ? "bg-red-500" : pct >= 0.75 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-navy-50 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full transition-all ${fill}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-xs text-navy-400 shrink-0 tabular-nums w-40 text-right">
        {formatHours(used)} / {formatHours(total)} hrs {total > 0 ? `(${Math.round(rawPct * 100)}%)` : used > 0 ? "(over)" : ""}
      </span>
    </div>
  );
}

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export default function AdminPackagesPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { courseTypes } = useCourseTypes();
  const { programTypes } = useProgramTypes();
  const { lockPackage, unlockPackage } = useStudentPackages();

  const [studentRows, setStudentRows] = useState<StudentRow[]>([]);
  const [sessionMap, setSessionMap] = useState<Map<string, { course_type_id: number | null; student_package_id: number | null; session_duration_hrs: number | null; no_show_type: string | null }[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lockBusyId, setLockBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: students }, { data: packages }, { data: sessions }] = await Promise.all([
      supabase.from("students").select("*").order("id"),
      supabase.from("student_packages").select("*, package_topups(*)"),
      // No no_show_type filter here — No Show + still bills (see
      // utils/noShow.ts), so excluding every no-show at the query level
      // undercounted hours used vs. the student-detail page, which fetches
      // every session and lets computeHoursUsed's isNonBillableNoShow check
      // do the (correct) filtering instead.
      supabase.from("session_logs").select("student_id, course_type_id, student_package_id, session_duration_hrs, no_show_type"),
    ]);

    // Build per-student session map
    const sMap = new Map<string, typeof sessions>();
    for (const s of (sessions ?? [])) {
      if (!s.student_id) continue;
      const arr = sMap.get(s.student_id) ?? [];
      arr.push(s);
      sMap.set(s.student_id, arr);
    }
    setSessionMap(sMap as typeof sessionMap);

    // Attach packages to students
    const pkgs = (packages ?? []) as PackageWithTopups[];
    const rows = (students ?? []).map((stu) => ({
      ...(stu as Student),
      packages: pkgs.filter((p) => p.student_id === stu.id),
    }));
    setStudentRows(rows);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = studentRows.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.first_name.toLowerCase().includes(q) ||
      s.last_name.toLowerCase().includes(q)
  );

  // Only show students who have at least one package (unless searching)
  const visible = search ? filtered : filtered.filter((s) => s.packages.length > 0);

  // Fallback mapping for sessions whose course_type_id wasn't backfilled:
  // course_type_id -> set of program_type_id values (including subtypes,
  // e.g. "IB DP" under "Academic") that belong to that course type. Without
  // this, sessions logged before the course_type_id column existed would be
  // silently excluded from hours-used here (this page previously omitted it,
  // unlike the student detail page).
  const courseTypeToProgramTypeIds = new Map<number, Set<number>>();
  for (const pt of programTypes) {
    const topLevel = pt.parent_id == null ? pt : programTypes.find((p) => p.id === pt.parent_id);
    if (!topLevel?.type) continue;
    const ctName = PROGRAM_TYPE_TO_COURSE_TYPE_NAME[topLevel.type];
    const ct = courseTypes.find((c) => c.name === ctName);
    if (!ct) continue;
    if (!courseTypeToProgramTypeIds.has(ct.id)) courseTypeToProgramTypeIds.set(ct.id, new Set());
    courseTypeToProgramTypeIds.get(ct.id)!.add(pt.id);
  }

  async function handleLock(pkg: StudentPackage, hoursUsed: number) {
    if (!profile) return;
    if (!window.confirm("Lock this package? No more hours or session-log changes can be made against it — renewing this course type afterwards will start a brand-new package.")) return;
    setLockBusyId(pkg.id);
    await lockPackage({ packageId: pkg.id, hoursUsed, lockedByUserId: profile.id });
    setLockBusyId(null);
    load();
  }

  async function handleUnlock(pkg: StudentPackage) {
    setLockBusyId(pkg.id);
    await unlockPackage(pkg.id);
    setLockBusyId(null);
    load();
  }

  function getCt(courseTypeId: number) {
    return courseTypes.find((c) => c.id === courseTypeId);
  }

  const totalPackages = studentRows.reduce((sum, s) => sum + s.packages.length, 0);
  const studentsWithPackages = studentRows.filter((s) => s.packages.length > 0).length;

  return (
    <AdminLayout>
      <PageHeader
        title="Learner's actual hours"
        description="Track hour balances across all students. Hours are added only through the Add / Renew invoice flow — this view is read-only apart from locking a package generation."
        action={
          <Button onClick={() => navigate("/admin/students/enroll")} className="flex items-center gap-2">
            Add / Renew — send invoice
          </Button>
        }
      />

      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <Card className="p-4">
            <p className="text-xs text-navy-400">Students with packages</p>
            <p className="text-2xl font-bold text-navy-700 mt-1">{studentsWithPackages}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-navy-400">Total active packages</p>
            <p className="text-2xl font-bold text-navy-700 mt-1">{totalPackages}</p>
          </Card>
          <Card className="p-4 hidden sm:block">
            <p className="text-xs text-navy-400">Total students</p>
            <p className="text-2xl font-bold text-navy-700 mt-1">{studentRows.length}</p>
          </Card>
        </div>
      )}

      <div className="mb-5 flex items-center gap-3">
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            placeholder="Search by student ID or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-navy-100 pl-4 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-300 hover:text-navy-500 text-sm"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        {!search && (
          <span className="text-xs text-navy-400 shrink-0">{visible.length} students with packages</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : visible.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-400">
            {search ? `No students match "${search}".` : "No packages found. Use “Add / Renew” to send an invoice — the package is created once payment is confirmed."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((student) => {

            // Group pools by their bundle (package_type_id) so a Foundation
            // Program / All-In-One student's pools show under one heading
            // instead of as loose, identically-named Beyond Academic cards.
            const bundleGroups = new Map<number, PackageWithTopups[]>();
            const standalonePkgs: PackageWithTopups[] = [];
            for (const p of student.packages) {
              if (p.package_type_id != null) {
                const arr = bundleGroups.get(p.package_type_id) ?? [];
                arr.push(p);
                bundleGroups.set(p.package_type_id, arr);
              } else {
                standalonePkgs.push(p);
              }
            }

            function renderPoolCard(pkg: PackageWithTopups) {
              const ct = getCt(pkg.course_type_id);
              const hoursUsed = pkg.hours_used;
              const remaining = pkg.total_hours_purchased - hoursUsed;
              const pctUsed = pkg.total_hours_purchased > 0 ? hoursUsed / pkg.total_hours_purchased : 0;

              return (
                <div
                  key={pkg.id}
                  onClick={() => navigate(`/admin/students/${student.id}?tab=packages`)}
                  className={`border rounded-xl p-3.5 cursor-pointer transition-colors ${
                    pkg.is_locked
                      ? "border-navy-100 bg-navy-50/60 hover:border-navy-200"
                      : "border-navy-50 bg-slate-50/40 hover:border-sky-200 hover:bg-sky-50/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(ct?.color ?? null)}`}>
                        {pkg.pool_label ?? ct?.name ?? `Type ${pkg.course_type_id}`}
                      </span>
                      {pkg.is_locked && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-navy-200 bg-white text-navy-500">
                          🔒 Locked
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold ${pctUsed >= 1 ? "text-red-600" : pctUsed >= 0.75 ? "text-yellow-600" : "text-green-600"}`}>
                        {remaining < 0 ? `${formatHours(Math.abs(remaining))} hrs over` : `${formatHours(remaining)} hrs remaining`}
                      </span>
                      {pkg.is_locked ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnlock(pkg); }}
                          disabled={lockBusyId === pkg.id}
                          className="text-xs text-navy-400 hover:text-navy-600 font-medium px-2 py-1 rounded-lg border border-navy-100 hover:border-navy-300 transition-colors"
                        >
                          {lockBusyId === pkg.id ? "…" : "Unlock"}
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleLock(pkg, hoursUsed); }}
                          disabled={lockBusyId === pkg.id}
                          className="text-xs text-navy-400 hover:text-navy-600 font-medium px-2 py-1 rounded-lg border border-navy-100 hover:border-navy-300 transition-colors"
                        >
                          {lockBusyId === pkg.id ? "…" : "Lock"}
                        </button>
                      )}
                    </div>
                  </div>
                  <BalanceBar used={hoursUsed} total={pkg.total_hours_purchased} />
                  {pctUsed >= 0.75 && !pkg.is_locked && (
                    <p className={`text-xs mt-1.5 font-medium ${pctUsed >= 1 ? "text-red-500" : "text-yellow-500"}`}>
                      {pctUsed >= 1 ? "Package fully used — exceeded allotted hours" : "Running low"}
                    </p>
                  )}
                </div>
              );
            }

            return (
              <Card key={student.id} className="p-4 hover:shadow-md transition-shadow">
                {/* Student header */}
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-navy-50">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                      {initials(student.first_name, student.last_name)}
                    </div>
                    <div>
                      <span className="font-semibold text-navy-700">{student.first_name} {student.last_name}</span>
                      <span className="ml-2 font-mono text-xs font-bold text-sky-500">{student.id}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(`/admin/students/enroll?student=${student.id}`)}
                    className="text-sm text-sky-500 hover:text-sky-700 font-medium"
                  >
                    Renew / Add hours →
                  </button>
                </div>

                {/* Package rows */}
                <div className="space-y-4">
                  {Array.from(bundleGroups.entries()).map(([packageTypeId, pools]) => {
                    const bundleCt = getCt(packageTypeId);
                    return (
                      <div key={`bundle-${packageTypeId}`} className="space-y-2">
                        <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(bundleCt?.color ?? null)}`}>
                          {bundleCt?.name ?? "Bundle"}
                        </span>
                        <div className="space-y-2 pl-3 border-l-2 border-navy-50">
                          {pools.map(renderPoolCard)}
                        </div>
                      </div>
                    );
                  })}

                  {standalonePkgs.map(renderPoolCard)}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}

import { useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import { useStudentPackages } from "../../hooks/useStudentPackages";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useTeachers } from "../../hooks/useTeachers";
import type { PackageTopup, SessionLog, Student, StudentPackage } from "../../types/database";
import { formatHours } from "../../utils/formatHours";
import { FamilyUsageBar } from "../students/FamilyUsageBar";
import { useFamilyPackageUsage } from "../../hooks/useFamilyPackageUsage";
import { isFamilyPackage, siblingColorMap, familyColorOrder } from "../../utils/familyPackages";
import { subjectLabel } from "../../utils/subjectLabel";
import { sessionCountLabel } from "../../utils/noShow";
import { BalanceBar } from "./packageUi";
import { courseTypeBadge } from "./courseTypeBadge";

type PackageWithTopups = StudentPackage & { package_topups: PackageTopup[] };
type BalanceSession = Pick<
  SessionLog,
  "id" | "session_date" | "course_type_id" | "program_type_id" | "student_package_id" | "session_duration_hrs" | "no_show_type" | "subject_id" | "curriculum_id" | "teacher_id" | "pool_ambiguous"
>;

const PROGRAM_TYPE_TO_COURSE_TYPE_NAME: Record<string, string> = {
  academic: "Academic",
  beyond_academic: "Beyond Academic",
};

// Read-only package-status view for a single student. Same balance bars and
// subject/teacher breakdowns the admin/PC see, minus every write action.
export function StudentPackagesView({ student }: { student: Student }) {
  const { courseTypes } = useCourseTypes();
  const { programTypes } = useProgramTypes();
  const { fetchPackagesForStudent, fetchSessionsForBalance, computeHoursUsedBySubject, computeHoursUsedByTeacher } = useStudentPackages();
  const { subjects } = useSubjects();
  const { curricula } = useCurricula();
  const { teachers } = useTeachers();

  const [packages, setPackages] = useState<PackageWithTopups[]>([]);
  const [sessions, setSessions] = useState<BalanceSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [pkgs, sess] = await Promise.all([fetchPackagesForStudent(student.id, student.parent_id), fetchSessionsForBalance(student.id)]);
      if (cancelled) return;
      setPackages(pkgs);
      setSessions(sess as BalanceSession[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [student.id, fetchPackagesForStudent, fetchSessionsForBalance]);

  // Per-sibling usage of every pool this student can draw on. Comes from the
  // aggregate RPC, which is what lets a student see how much of a shared pool a
  // sibling used without gaining any access to that sibling's session logs.
  const { usageByPackage } = useFamilyPackageUsage(packages.filter(isFamilyPackage).map((p) => p.id));
  const colors = siblingColorMap(familyColorOrder(usageByPackage.values()));

  const subjectLookup = new Map(subjects.map((s) => [s.id, { name: s.name, level: s.level }]));
  const curriculumLookup = new Map(curricula.map((c) => [c.id, c.name]));
  const teacherLookup = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));

  // Fallback mapping (course_type_id -> program_type_ids) for sessions whose
  // course_type_id wasn't backfilled — same derivation the admin page uses.
  const courseTypeToProgramTypeIds = new Map<number, Set<number>>();
  for (const pt of programTypes) {
    const topLevel = pt.parent_id == null ? pt : programTypes.find((p) => p.id === pt.parent_id);
    if (!topLevel?.type) continue;
    const ctName = PROGRAM_TYPE_TO_COURSE_TYPE_NAME[topLevel.type];
    const ct = ctName ? courseTypes.find((c) => c.name === ctName) : undefined;
    if (!ct) continue;
    if (!courseTypeToProgramTypeIds.has(ct.id)) courseTypeToProgramTypeIds.set(ct.id, new Set());
    courseTypeToProgramTypeIds.get(ct.id)!.add(pt.id);
  }

  // Group pools by bundle (Foundation Program / All-In-One) so a bundle
  // student's pools show under one heading, matching the admin view.
  const bundleGroups = new Map<number, PackageWithTopups[]>();
  const standalonePkgs: PackageWithTopups[] = [];
  for (const p of packages) {
    if (p.package_type_id != null) {
      const arr = bundleGroups.get(p.package_type_id) ?? [];
      arr.push(p);
      bundleGroups.set(p.package_type_id, arr);
    } else {
      standalonePkgs.push(p);
    }
  }

  function renderPoolCard(pkg: PackageWithTopups) {
    const ct = courseTypes.find((c) => c.id === pkg.course_type_id);
    const hoursUsed = pkg.hours_used;
    const hoursRemaining = pkg.total_hours_purchased - hoursUsed;
    const pctUsed = pkg.total_hours_purchased > 0 ? hoursUsed / pkg.total_hours_purchased : 0;
    // Only this student's own sessions — RLS gives them nothing else, which is
    // exactly right: the By subject / By teacher breakdowns below stay strictly
    // personal even on a shared pool.
    const pkgSessions = sessions.filter((s) => s.student_package_id === pkg.id);
    const familyUsage = usageByPackage.get(pkg.id) ?? [];
    // A shared pool is only worth splitting out once more than one child has
    // actually drawn on it; before that it reads like an ordinary package.
    const showFamilySplit = isFamilyPackage(pkg) && familyUsage.length > 1;
    const subjectBreakdown = computeHoursUsedBySubject(pkgSessions);
    const teacherBreakdown = computeHoursUsedByTeacher(pkgSessions);

    return (
      <div key={pkg.id} className="border border-navy-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(ct?.color ?? null)}`}>
            {pkg.pool_label ?? ct?.name ?? `Type ${pkg.course_type_id}`}
          </span>
          <span className={`text-sm font-bold ${pctUsed >= 0.9 ? "text-red-600" : pctUsed >= 0.75 ? "text-yellow-600" : "text-green-600"}`}>
            {formatHours(hoursRemaining)} hrs remaining
          </span>
        </div>
        {showFamilySplit ? (
          <FamilyUsageBar
            usage={familyUsage}
            purchasedHours={pkg.total_hours_purchased}
            colors={colors}
            highlightStudentId={student.id}
          />
        ) : (
          <BalanceBar used={hoursUsed} total={pkg.total_hours_purchased} />
        )}
        {pctUsed >= 0.75 && (
          <p className={`text-xs mt-1 ${pctUsed >= 0.9 ? "text-red-500" : "text-yellow-500"}`}>
            {pctUsed >= 0.9 ? "Package almost depleted — a renewal may be needed soon" : "Package running low"}
          </p>
        )}

        {(subjectBreakdown.length > 0 || teacherBreakdown.length > 0) && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-navy-50 pt-3">
            <div>
              <p className="text-xs font-semibold text-navy-500 mb-1.5">By subject</p>
              <div className="space-y-1">
                {subjectBreakdown.map((s) => {
                  const subj = subjectLookup.get(s.subjectId);
                  const label = subj ? subjectLabel(subj.name, subj.level) : `Subject ${s.subjectId}`;
                  const curriculum = s.curriculumId != null ? curriculumLookup.get(s.curriculumId) : null;
                  return (
                    <div key={`${s.subjectId}:${s.curriculumId ?? ""}`} className="flex items-center justify-between text-xs">
                      <span className="text-navy-600">{label}{curriculum ? ` (${curriculum})` : ""}</span>
                      <span className="text-navy-400 tabular-nums shrink-0 ml-2">
                        {formatHours(s.hours)} hrs · {sessionCountLabel(s.sessionCount, s.noShowCount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-navy-500 mb-1.5">By teacher</p>
              <div className="space-y-1">
                {teacherBreakdown.map((t) => (
                  <div key={t.teacherId} className="flex items-center justify-between text-xs">
                    <span className="text-navy-600">{teacherLookup.get(t.teacherId) ?? `Teacher ${t.teacherId}`}</span>
                    <span className="text-navy-400 tabular-nums shrink-0 ml-2">
                      {formatHours(t.hours)} hrs · {sessionCountLabel(t.sessionCount, t.noShowCount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="p-5">
      <p className="font-semibold text-navy-700 mb-4">Package status</p>
      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : packages.length === 0 ? (
        <p className="text-sm text-navy-400">No packages yet.</p>
      ) : (
        <div className="space-y-4">
          {Array.from(bundleGroups.entries()).map(([packageTypeId, pools]) => {
            const bundleCt = courseTypes.find((c) => c.id === packageTypeId);
            return (
              <div key={`bundle-${packageTypeId}`} className="space-y-2">
                <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(bundleCt?.color ?? null)}`}>
                  {bundleCt?.name ?? "Bundle"}
                </span>
                <div className="space-y-4 pl-3 border-l-2 border-navy-50">
                  {pools.map(renderPoolCard)}
                </div>
              </div>
            );
          })}
          {standalonePkgs.map(renderPoolCard)}
        </div>
      )}
    </Card>
  );
}

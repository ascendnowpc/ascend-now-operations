import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../layout/PageHeader";
import { Card } from "../ui/Card";
import { TextInput } from "../ui/Input";
import { DataTable, type ColumnDef } from "../ui/DataTable";
import { useStudents } from "../../hooks/useStudents";
import { useTeachers } from "../../hooks/useTeachers";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useUsers } from "../../hooks/useUsers";
import { supabase } from "../../lib/supabaseClient";
import type { PackageTopup, Student, StudentPackage } from "../../types/database";

type PackageWithTopups = StudentPackage & { package_topups: PackageTopup[] };

type PackageStatus = "none" | "under_50" | "between_50_75" | "between_75_100" | "completed_or_over";

const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  none: "No package",
  under_50: "< 50% used (healthy)",
  between_50_75: "50–75% used",
  between_75_100: "75–99% used (running low)",
  completed_or_over: "100%+ used (done / exceeded)",
};

/**
 * Shared students-list view used by BOTH the admin (`/admin/students`) and
 * the performance-coach (`/teacher/students`, "My Students") pages — one
 * component so the search/filter/table never drift apart again (the PC page
 * used to be a much simpler, separately-maintained list with none of the
 * admin's columns, search fields, or filters). The two roles differ ONLY in:
 *   - which students are visible at all (`allowedIds`, undefined for admin =
 *     no restriction; a PC's own assigned-student id set otherwise — RLS
 *     already scopes the package/session data itself per-PC, this is just
 *     which rows of the globally-readable `students` table are shown);
 *   - the header action (admin's "Add / Renew Student"; a PC has none — PCs
 *     can no longer self-assign, that's an admin-only action);
 *   - `children`, an optional slot rendered between the header and the
 *     search/filter card (currently unused now the PC self-assign flow is
 *     gone, kept so a role can slot in extra UI without the shared view
 *     needing to know about it).
 * Everything else — every column, the search fields, the country/package
 * filters, and the package-status computation — is identical.
 */
export function StudentsListView({
  title,
  description,
  headerAction,
  allowedIds,
  detailPath,
  emptyMessage,
  children,
  showPcFilter = true,
}: {
  title: string;
  description: string;
  headerAction?: ReactNode;
  /** Undefined = no restriction (admin sees every student). */
  allowedIds?: Set<string>;
  detailPath: (studentId: string) => string;
  emptyMessage?: string;
  children?: ReactNode;
  /**
   * Whether to show the "Performance Coach" filter dropdown. Defaults to true
   * (admin). A PC's own "My Students" list hides it — every visible student is
   * already assigned to that one coach, so filtering by coach is pointless.
   */
  showPcFilter?: boolean;
}) {
  const navigate = useNavigate();
  const { students: allStudents, loading } = useStudents();
  const { teachers } = useTeachers();
  const { getPcForStudent } = usePcAssignments();
  const { users } = useUsers();

  const students = useMemo(
    () => (allowedIds ? allStudents.filter((s) => allowedIds.has(s.id)) : allStudents),
    [allStudents, allowedIds]
  );

  const teacherLookup = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
  const usernameByUserId = new Map(users.map((u) => [u.id, u.username]));

  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [packageFilter, setPackageFilter] = useState<PackageStatus | "">("");
  const [curriculumFilter, setCurriculumFilter] = useState("");
  const [graduationYearFilter, setGraduationYearFilter] = useState("");
  const [pcFilter, setPcFilter] = useState("");

  // Package/session data, fetched once, used to compute each student's
  // package status: the worst (highest) usage percentage across their
  // packages (one hours balance per course type). RLS already scopes what
  // comes back to a PC's own assigned students, so no client-side filtering
  // is needed here — only which STUDENT ROWS are shown needs `allowedIds`.
  const [packagesByStudent, setPackagesByStudent] = useState<Map<string, PackageWithTopups[]>>(new Map());

  const loadPackageData = useCallback(async () => {
    // Package usage now comes from the stored student_packages.hours_used
    // column (maintained DB-side), so no per-session fetch is needed here.
    const { data: packages } = await supabase.from("student_packages").select("*, package_topups(*)");

    const pMap = new Map<string, PackageWithTopups[]>();
    for (const p of (packages ?? []) as PackageWithTopups[]) {
      if (!p.student_id) continue;
      const arr = pMap.get(p.student_id) ?? [];
      arr.push(p);
      pMap.set(p.student_id, arr);
    }
    setPackagesByStudent(pMap);
  }, []);

  useEffect(() => { loadPackageData(); }, [loadPackageData]);

  // Worst-case (highest) usage percentage across all of a student's packages.
  const packageStatusByStudent = useMemo(() => {
    const map = new Map<string, PackageStatus>();
    for (const student of students) {
      const pkgs = packagesByStudent.get(student.id) ?? [];
      if (pkgs.length === 0) {
        map.set(student.id, "none");
        continue;
      }
      let maxPct = 0;
      for (const pkg of pkgs) {
        const used = pkg.hours_used;
        const pct = pkg.total_hours_purchased > 0 ? used / pkg.total_hours_purchased : 0;
        if (pct > maxPct) maxPct = pct;
      }
      let status: PackageStatus;
      if (maxPct >= 1) status = "completed_or_over";
      else if (maxPct >= 0.75) status = "between_75_100";
      else if (maxPct >= 0.5) status = "between_50_75";
      else status = "under_50";
      map.set(student.id, status);
    }
    return map;
  }, [students, packagesByStudent]);

  const availableCountries = useMemo(() => {
    const set = new Set(students.map((s) => s.country).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [students]);

  const availableCurricula = useMemo(() => {
    const set = new Set(students.map((s) => s.curriculum).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [students]);

  const availableGraduationYears = useMemo(() => {
    const set = new Set(
      students.map((s) => s.graduation_year).filter((y): y is number => y != null)
    );
    return Array.from(set).sort((a, b) => a - b);
  }, [students]);

  // Performance coaches that are actually assigned to at least one visible
  // student, so the dropdown stays short and every option returns a result.
  // "__unassigned__" is offered whenever some student has no PC.
  const availablePcs = useMemo(() => {
    const ids = new Set<string>();
    let hasUnassigned = false;
    for (const s of students) {
      const pcId = getPcForStudent(s.id);
      if (pcId != null) ids.add(pcId);
      else hasUnassigned = true;
    }
    const list = Array.from(ids)
      .map((id) => ({ id, name: teacherLookup.get(id) ?? `#${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { list, hasUnassigned };
  }, [students, getPcForStudent, teacherLookup]);

  const q = search.toLowerCase();
  const filtered = students.filter((s) => {
    const studentUsername = s.user_id ? usernameByUserId.get(s.user_id) : undefined;
    const matchesSearch =
      !q ||
      s.id.toLowerCase().includes(q) ||
      s.first_name.toLowerCase().includes(q) ||
      s.last_name.toLowerCase().includes(q) ||
      (s.email ?? "").toLowerCase().includes(q) ||
      (s.notification_email ?? "").toLowerCase().includes(q) ||
      (s.parent_full_name ?? "").toLowerCase().includes(q) ||
      (s.phone_number ?? "").toLowerCase().includes(q) ||
      (s.parent_phone_number ?? "").toLowerCase().includes(q) ||
      (s.address ?? "").toLowerCase().includes(q) ||
      (s.school ?? "").toLowerCase().includes(q) ||
      (s.curriculum ?? "").toLowerCase().includes(q) ||
      (studentUsername ?? "").toLowerCase().includes(q);

    const matchesCountry = !countryFilter || s.country === countryFilter;
    const matchesPackage = !packageFilter || packageStatusByStudent.get(s.id) === packageFilter;
    const matchesCurriculum = !curriculumFilter || s.curriculum === curriculumFilter;
    const matchesGraduationYear =
      !graduationYearFilter || String(s.graduation_year ?? "") === graduationYearFilter;
    const matchesPc =
      !pcFilter ||
      (pcFilter === "__unassigned__"
        ? getPcForStudent(s.id) == null
        : String(getPcForStudent(s.id) ?? "") === pcFilter);

    return (
      matchesSearch &&
      matchesCountry &&
      matchesPackage &&
      matchesCurriculum &&
      matchesGraduationYear &&
      matchesPc
    );
  });

  const activeFilterCount = [
    countryFilter,
    packageFilter,
    curriculumFilter,
    graduationYearFilter,
    pcFilter,
  ].filter(Boolean).length;

  function clearFilters() {
    setCountryFilter("");
    setPackageFilter("");
    setCurriculumFilter("");
    setGraduationYearFilter("");
    setPcFilter("");
  }

  const columns: ColumnDef<Student>[] = [
    { header: "ID", accessor: (s) => <span className="font-mono text-xs font-semibold text-sky-500">{s.id}</span>, className: "whitespace-nowrap" },
    { header: "First name", accessor: (s) => s.first_name },
    { header: "Last name", accessor: (s) => s.last_name },
    { header: "Student Email", accessor: (s) => s.email ?? "—" },
    { header: "Send updates to", accessor: (s) => s.notification_email ?? "—" },
    {
      header: "Username",
      accessor: (s) => s.user_id ? (usernameByUserId.get(s.user_id) ?? "—") : <span className="text-navy-300 italic">No login</span>,
    },
    { header: "Curriculum", accessor: (s) => s.curriculum ?? "—" },
    // The former parent/guardian's details, now plain fields on the student
    // record (there is no separate parent account anymore).
    { header: "Parent/Guardian name", accessor: (s) => s.parent_full_name ?? "—" },
    { header: "Parent/Guardian Phone", accessor: (s) => s.parent_phone_number ?? "—" },
    { header: "Student Phone", accessor: (s) => s.phone_number ?? "—" },
    { header: "Address", accessor: (s) => s.address ?? "—" },
    { header: "Country", accessor: (s) => s.country ?? "—" },
    { header: "School", accessor: (s) => s.school ?? "—" },
    { header: "Graduation Year", accessor: (s) => s.graduation_year ?? "—" },
    { header: "Birthday", accessor: (s) => s.birthday ? new Date(s.birthday).toLocaleDateString() : "—" },
    {
      header: "PC",
      accessor: (s) => {
        const pcId = getPcForStudent(s.id);
        return pcId ? (teacherLookup.get(pcId) ?? `#${pcId}`) : <span className="text-amber-600">Unassigned</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader title={title} description={description} action={headerAction} />

      {children}

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <TextInput
              label="Search"
              placeholder="Search by ID, name, email, parent, phone, address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Country</label>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="">All countries</option>
              {availableCountries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Package status</label>
            <select
              value={packageFilter}
              onChange={(e) => setPackageFilter(e.target.value as PackageStatus | "")}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="">All statuses</option>
              {(Object.keys(PACKAGE_STATUS_LABEL) as PackageStatus[]).map((status) => (
                <option key={status} value={status}>{PACKAGE_STATUS_LABEL[status]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Curriculum</label>
            <select
              value={curriculumFilter}
              onChange={(e) => setCurriculumFilter(e.target.value)}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="">All curricula</option>
              {availableCurricula.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Graduation year</label>
            <select
              value={graduationYearFilter}
              onChange={(e) => setGraduationYearFilter(e.target.value)}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="">All years</option>
              {availableGraduationYears.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>
          {showPcFilter && (
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1">Performance Coach</label>
              <select
                value={pcFilter}
                onChange={(e) => setPcFilter(e.target.value)}
                className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <option value="">All coaches</option>
                {availablePcs.hasUnassigned && <option value="__unassigned__">Unassigned</option>}
                {availablePcs.list.map((pc) => (
                  <option key={pc.id} value={pc.id}>{pc.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="mt-3 text-sm text-navy-400 hover:text-red-500">
            Clear filters
          </button>
        )}
      </Card>

      <p className="text-xs text-navy-400 mb-2">{filtered.length} of {students.length} students</p>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={(s) => s.id}
        loading={loading}
        onRowClick={(s) => navigate(detailPath(s.id))}
        emptyMessage={emptyMessage}
      />
    </>
  );
}

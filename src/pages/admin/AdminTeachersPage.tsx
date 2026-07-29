import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { IconPlus, IconDownload } from "../../components/ui/icons";
import { useTeachers, useInactiveTeachers, useAllTeacherSubjects, mergeWithSubjects } from "../../hooks/useTeachers";
import { useUsers } from "../../hooks/useUsers";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups, subjectDisplayLabel } from "../../hooks/useCurriculumGroups";
import { SubjectLevelSelect } from "../../components/ui/SubjectLevelSelect";
import type { TeacherWithSubjects } from "../../types/database";
import { idSeqNumber } from "../../utils/entityId";

// Every subject lives under exactly one of these three branches — see
// db/docs/SUBJECT_HIERARCHY.md §1. Not expected to grow without a wider
// change (program_types/course_types/session-log forms all key off the same
// three), but which *subjects* fall in each branch is read live below.
type SubjectBranch = "academic" | "beyond_academic" | "college_counselling";

function exportCsv(
  teachers: TeacherWithSubjects[],
  usernameLookup: Map<string, string>,
  subjectsById: Map<number, { name: string; board: string | null; subject_code: string | null; level: string | null; curriculum_group_id: number | null }>,
  curriculumLookup: Map<number, string>,
  groupLookup: Map<number, string>
) {
  function subjectLabel(subjectId: number, curriculumId: number | null) {
    const sub = subjectsById.get(subjectId);
    const subLabel = sub ? subjectDisplayLabel(sub.name, sub.board, sub.subject_code, sub.level) : String(subjectId);
    if (!curriculumId) return subLabel;
    const cur = curriculumLookup.get(curriculumId);
    const group = sub?.curriculum_group_id ? groupLookup.get(sub.curriculum_group_id) : null;
    const parts = [cur, group, subLabel].filter(Boolean);
    return parts.join(" | ");
  }
  const headers = ["First Name", "Last Name", "Username", "Email", "Phone", "Country", "Performance Coach", "Active", "Subjects"];
  const rows = teachers.map((t) => [
    t.first_name,
    t.last_name ?? "",
    t.user_id ? (usernameLookup.get(t.user_id) ?? "") : "",
    t.email ?? "",
    t.phone_number ?? "",
    t.country ?? "",
    t.is_performance_coach ? "Yes" : "No",
    t.is_active ? "Active" : "Inactive",
    (t.teacher_subjects ?? []).map((s) => subjectLabel(s.subject_id, s.curriculum_id ?? null)).join("\n"),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "teachers.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminTeachersPage() {
  const { teachers: rawTeachers, loading } = useTeachers();
  const { teachers: inactiveRaw, loading: inactiveLoading } = useInactiveTeachers();
  const { subjectsByTeacher } = useAllTeacherSubjects();
  const { users } = useUsers();
  const { subjects } = useSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();
  // Ordered by ID rather than the hook's default name sort (the shared
  // useTeachers order stays alphabetical for the coach dropdowns elsewhere).
  const byId = (a: TeacherWithSubjects, b: TeacherWithSubjects) => idSeqNumber(a.id) - idSeqNumber(b.id);
  // Teachers only — performance coaches are listed under their own PC page
  // (/admin/pcs). A PC is a teacher with is_performance_coach = true.
  const activeTeachers = mergeWithSubjects(rawTeachers.filter((t) => t.is_active && !t.is_performance_coach), subjectsByTeacher).sort(byId);
  const inactiveTeachers = mergeWithSubjects(inactiveRaw.filter((t) => !t.is_performance_coach), subjectsByTeacher).sort(byId);
  const curriculumLookup = new Map(curricula.map((c) => [c.id, c.name]));
  const allTeacherSubjectsFlat = Array.from(subjectsByTeacher.values()).flat();

  const subjectsById = new Map(subjects.map((s) => [s.id, s]));
  const groupLookup = new Map(allGroups.map((g) => [g.id, g.name]));

  // Derived from the live `category` field (the same canonical check
  // TeacherSubjectEditor.tsx uses), not a hardcoded id/category-table list —
  // a newly added subject is picked up automatically without a code change.
  function subjectBranch(subjectId: number): SubjectBranch | null {
    const s = subjectsById.get(subjectId);
    if (!s) return null;
    if (s.category === "academic") return "academic";
    if (s.category === "college_counselling") return "college_counselling";
    return "beyond_academic";
  }

  const [tab, setTab] = useState<"active" | "deactivated">("active");
  const [search, setSearch] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterSubjectType, setFilterSubjectType] = useState<"" | SubjectBranch>("");
  const [filterCurriculum, setFilterCurriculum] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const navigate = useNavigate();

  const usernameLookup = new Map(users.map((u) => [u.id, u.username]));
  const uniqueCountries = [...new Set([...activeTeachers, ...inactiveTeachers].map((t) => t.country).filter(Boolean) as string[])].sort();

  function applyFilters(list: TeacherWithSubjects[]) {
    return list.filter((t) => {
      const ts = t.teacher_subjects ?? [];
      const nameMatch = `${t.first_name} ${t.last_name ?? ""} ${t.email ?? ""}`.toLowerCase().includes(search.toLowerCase());
      const countryMatch = !filterCountry || t.country === filterCountry;
      const typeMatch =
        !filterSubjectType ||
        ts.some((s) => subjectBranch(s.subject_id) === filterSubjectType);
      const curriculumMatch =
        !filterCurriculum ||
        ts.some((s) => String(s.curriculum_id) === filterCurriculum);
      const subjectMatch =
        !filterSubject ||
        ts.some((s) => String(s.subject_id) === filterSubject);
      return nameMatch && countryMatch && typeMatch && curriculumMatch && subjectMatch;
    });
  }

  const filtered = applyFilters(activeTeachers);
  const filteredInactive = applyFilters(inactiveTeachers);

  const columns: ColumnDef<TeacherWithSubjects>[] = [
    { header: "ID", accessor: (t) => t.id },
    { header: "First name", accessor: (t) => t.first_name },
    { header: "Last name", accessor: (t) => t.last_name ?? "—" },
    { header: "Username", accessor: (t) => t.user_id ? (usernameLookup.get(t.user_id) ?? "—") : "—" },
    { header: "Email", accessor: (t) => t.email ?? "—" },
    { header: "Phone", accessor: (t) => t.phone_number ?? "—" },
    { header: "Country", accessor: (t) => t.country ?? "—" },
    {
      header: "Status",
      accessor: (t) =>
        t.is_active ? (
          <span className="inline-block rounded-pill bg-lime-100 text-lime-600 px-3 py-0.5 text-xs font-semibold">
            Active
          </span>
        ) : (
          <span className="inline-block rounded-pill bg-navy-50 text-navy-300 px-3 py-0.5 text-xs font-semibold">
            Inactive
          </span>
        ),
    },
  ];

  const hasFilters = search || filterCountry || filterSubjectType || filterCurriculum || filterGroup || filterSubject;

  return (
    <AdminLayout>
      <PageHeader
        title="Teachers"
        description="Teachers only — performance coaches are managed under the PC section."
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => exportCsv(filtered, usernameLookup, subjectsById, curriculumLookup, groupLookup)}
              className="flex items-center gap-2"
              disabled={filtered.length === 0}
            >
              <IconDownload /> Export CSV
            </Button>
            <Button onClick={() => navigate("/admin/teachers/new")} className="flex items-center gap-2">
              <IconPlus /> Add teacher
            </Button>
          </div>
        }
      />

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <TextInput
            label="Search name / email"
            placeholder="Name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectInput
            label="Country"
            placeholder="All countries"
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            options={uniqueCountries.map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <SelectInput
            label="Subject type"
            placeholder="All types"
            value={filterSubjectType}
            onChange={(e) => {
              setFilterSubjectType(e.target.value as "" | SubjectBranch);
              setFilterCurriculum("");
              setFilterGroup("");
              setFilterSubject("");
            }}
            options={[
              { value: "academic", label: "Academic" },
              { value: "beyond_academic", label: "Beyond Academics" },
              { value: "college_counselling", label: "College Counselling" },
            ]}
          />
          {filterSubjectType === "academic" && (
            <SelectInput
              label="Curriculum"
              placeholder="All curricula"
              value={filterCurriculum}
              onChange={(e) => { setFilterCurriculum(e.target.value); setFilterGroup(""); setFilterSubject(""); }}
              options={curricula.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          )}
          {filterSubjectType === "academic" && filterCurriculum && (
            <SelectInput
              label="Subject group"
              placeholder="All groups"
              value={filterGroup}
              onChange={(e) => { setFilterGroup(e.target.value); setFilterSubject(""); }}
              options={allGroups
                .filter((g) => g.is_active && String(g.curriculum_id) === filterCurriculum)
                .map((g) => ({ value: String(g.id), label: g.name }))}
            />
          )}
          {filterSubjectType === "academic" && filterCurriculum && (() => {
            const opts = filterGroup
              ? subjects.filter((s) => String(s.curriculum_group_id) === filterGroup)
              : filterCurriculum
              ? (() => {
                  const ids = new Set(
                    allTeacherSubjectsFlat
                      .filter((ts) => String(ts.curriculum_id) === filterCurriculum)
                      .map((ts) => ts.subject_id)
                  );
                  return subjects.filter((s) => ids.has(s.id));
                })()
              : subjects.filter((s) => s.category === "academic");
            // Level is always its own dropdown step, never baked into the
            // Subject option's label — see db/docs/SUBJECT_HIERARCHY.md §2.
            return (
              <SubjectLevelSelect
                subjects={opts}
                value={filterSubject}
                onChange={setFilterSubject}
                placeholder="All subjects"
                levelPlaceholder="All levels"
              />
            );
          })()}
          {/* Beyond Academic / College Counselling: flat Subject picker, no
              grouping — subject_categories is no longer used for either
              branch (db/docs/SUBJECT_HIERARCHY.md §3/§3b), so this reads
              straight off the live `subjects.category` field instead. */}
          {(filterSubjectType === "beyond_academic" || filterSubjectType === "college_counselling") && (() => {
            const opts = subjects.filter((s) => subjectBranch(s.id) === filterSubjectType);
            return (
              <SelectInput
                label="Subject"
                placeholder="All subjects"
                value={filterSubject}
                onChange={(e) => setFilterSubject(e.target.value)}
                options={opts.map((s) => ({ value: String(s.id), label: s.name }))}
              />
            );
          })()}
        </div>
        {hasFilters && (
          <button
            className="mt-2 text-sm text-sky-400 hover:underline"
            onClick={() => {
              setSearch("");
              setFilterCountry("");
              setFilterSubjectType("");
              setFilterCurriculum("");
              setFilterGroup("");
              setFilterSubject("");
            }}
          >
            Clear all filters
          </button>
        )}
      </Card>

      <div className="flex gap-2 mb-4">
        {(["active", "deactivated"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
              tab === t
                ? "bg-sky-500 border-sky-500 text-white"
                : "bg-white border-navy-100 text-navy-500 hover:border-sky-200"
            }`}
          >
            {t === "active" ? `Active (${filtered.length})` : `Deactivated (${filteredInactive.length})`}
          </button>
        ))}
      </div>

      {tab === "active" && (
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(t) => t.id}
          loading={loading}
          onRowClick={(t) => navigate(`/admin/teachers/${t.id}`)}
        />
      )}

      {tab === "deactivated" && (
        <DataTable
          columns={columns}
          rows={filteredInactive}
          getRowId={(t) => t.id}
          loading={inactiveLoading}
          onRowClick={(t) => navigate(`/admin/teachers/${t.id}`)}
        />
      )}
    </AdminLayout>
  );
}


import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { TextInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { TeacherSubjectEditor } from "../../components/subjects/TeacherSubjectEditor";
import { useTeachers, useAllTeacherSubjects, mergeWithSubjects } from "../../hooks/useTeachers";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllSubjectCategories } from "../../hooks/useSubjectCategories";
import { useAllCurriculumGroups, subjectDisplayLabel } from "../../hooks/useCurriculumGroups";

export default function AdminTeacherSubjectsPage() {
  const { teachers: rawTeachers, loading } = useTeachers();
  const { subjectsByTeacher, refetch: refetchAllSubjects } = useAllTeacherSubjects();
  const { subjects: allSubjects, createSubject } = useAllSubjects();
  const { curricula } = useCurricula();
  const { categories } = useAllSubjectCategories();
  const { groups: allGroups } = useAllCurriculumGroups();
  const academicCategories = categories.filter((c) => c.type === "academic" && c.is_active);
  const teachers = mergeWithSubjects(rawTeachers, subjectsByTeacher);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState<number | null>(null);

  function getLabel(subjectId: number, curriculumId: number | null): string {
    const sub = allSubjects.find((s) => s.id === subjectId);
    if (!sub) return `#${subjectId}`;
    const cur = curriculumId ? curricula.find((c) => c.id === curriculumId) : null;
    const group = sub.curriculum_group_id ? allGroups.find((g) => g.id === sub.curriculum_group_id) : null;
    const parts: string[] = [];
    if (cur) parts.push(cur.name);
    if (group) parts.push(group.name);
    parts.push(subjectDisplayLabel(sub.name, sub.board, sub.subject_code, sub.level));
    return parts.join(" | ");
  }

  const filtered = teachers.filter((t) => {
    const nameMatch = `${t.first_name} ${t.last_name ?? ""}`.toLowerCase().includes(teacherSearch.toLowerCase());
    const subjectMatch =
      !subjectSearch.trim() ||
      (t.teacher_subjects ?? []).some((s) =>
        getLabel(s.subject_id, s.curriculum_id).toLowerCase().includes(subjectSearch.toLowerCase())
      );
    return nameMatch && subjectMatch;
  });

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title="Teacher Subjects"
        description="View and manage the subjects each teacher is assigned to teach."
      />

      <div className="flex gap-3 mb-5 max-w-xl">
        <TextInput
          label="Search by teacher name"
          placeholder="Name…"
          value={teacherSearch}
          onChange={(e) => setTeacherSearch(e.target.value)}
        />
        <TextInput
          label="Search by subject"
          placeholder="e.g. IBDP | Biology"
          value={subjectSearch}
          onChange={(e) => setSubjectSearch(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        {filtered.map((t) => {
          const isSelected = t.id === selectedTeacherId;
          const subs = t.teacher_subjects ?? [];

          return (
            <div key={t.id}>
              <div
                className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                  isSelected
                    ? "border-sky-300 bg-sky-50"
                    : "border-navy-100 bg-white hover:border-sky-200 hover:bg-sky-50/30"
                }`}
                onClick={() => setSelectedTeacherId(isSelected ? null : t.id)}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div>
                    <p className="text-sm font-medium text-navy-700">
                      {t.first_name} {t.last_name ?? ""}
                      {t.is_performance_coach && (
                        <span className="ml-2 text-xs rounded-pill bg-lime-100 text-lime-600 px-2 py-0.5 font-semibold">
                          Coach
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-navy-300">{t.email ?? "—"}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-4">
                    {subs.length === 0 ? (
                      <span className="text-xs text-navy-200">No subjects</span>
                    ) : (
                      subs.map((s) => {
                        const subject = allSubjects.find((x) => x.id === s.subject_id);
                        const isInactive = subject ? !subject.is_active : false;
                        return (
                          <span
                            key={s.id}
                            className={`inline-block rounded-pill px-2 py-0.5 text-xs whitespace-nowrap ${
                              isInactive
                                ? "bg-navy-50 text-navy-300 italic"
                                : "bg-navy-50 text-navy-600"
                            }`}
                            title={isInactive ? "Subject is deactivated" : undefined}
                          >
                            {getLabel(s.subject_id, s.curriculum_id)}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
                <span className="text-xs text-sky-400 font-medium shrink-0">
                  {isSelected ? "Close ▲" : "Manage ▼"}
                </span>
              </div>

              {isSelected && (
                <TeacherSubjectEditor
                  variant="admin"
                  teacherId={t.id}
                  allSubjects={allSubjects}
                  curricula={curricula}
                  allGroups={allGroups}
                  academicCategories={academicCategories}
                  createSubject={createSubject}
                  onSubjectsChanged={() => refetchAllSubjects(true)}
                  header={
                    <p className="text-sm font-semibold text-navy-700 mb-3">
                      Subjects for {t.first_name} {t.last_name ?? ""}
                    </p>
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-navy-300 text-sm">No teachers match your search.</p>
      )}
    </AdminLayout>
  );
}

import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { TeacherSubjectEditor } from "../../components/subjects/TeacherSubjectEditor";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useTeacherSubjects } from "../../hooks/useTeachers";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllSubjectCategories } from "../../hooks/useSubjectCategories";
import { useAllCurriculumGroups } from "../../hooks/useCurriculumGroups";

export default function TeacherSubjectsPage() {
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();
  const { loading: subsLoading } = useTeacherSubjects(teacher?.id);
  const { subjects: allSubjectsAll, loading: allSubjectsLoading, createSubject } = useAllSubjects();
  const { curricula, loading: curriculaLoading } = useCurricula();
  const { categories, loading: catsLoading } = useAllSubjectCategories();
  const { groups: allGroups, loading: groupsLoading } = useAllCurriculumGroups();

  const isLoading = teacherLoading || subsLoading || allSubjectsLoading || curriculaLoading || catsLoading || groupsLoading;

  const academicCategories = categories.filter((c) => c.type === "academic" && c.is_active);

  return (
    <TeacherLayout>
      <PageHeader
        title="My Subjects"
        description="Subjects you're set up to teach. Add or remove them anytime."
      />

      <Card className="p-6 max-w-3xl">
        {isLoading && <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>}

        {teacherError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
            {teacherError}
          </p>
        )}

        {!isLoading && teacher && (
          <TeacherSubjectEditor
            variant="teacher"
            teacherId={teacher.id}
            allSubjects={allSubjectsAll}
            curricula={curricula}
            allGroups={allGroups}
            academicCategories={academicCategories}
            createSubject={createSubject}
          />
        )}
      </Card>
    </TeacherLayout>
  );
}

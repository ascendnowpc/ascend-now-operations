import { useMemo, useState } from "react";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { StudentSearch } from "../../components/ui/StudentSearch";
import { SubjectNotesList } from "../../components/notes/SubjectNotesList";
import { AddSubjectNoteForm } from "../../components/notes/AddSubjectNoteForm";
import { IconArrowLeft, IconBook, IconTag, IconBarChart } from "../../components/ui/icons";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useSessionLogs } from "../../hooks/useSessionLogs";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useTeachers } from "../../hooks/useTeachers";
import { useSubjectNotes } from "../../hooks/useSubjectNotes";
import { subjectLabel } from "../../utils/subjectLabel";
import { branchOfCategory, BRANCH_TITLES, BRANCH_ORDER, type BranchKey } from "../../utils/subjectBranch";
import type { Student, Subject } from "../../types/database";

// One subject a teacher can file a note against — keyed by subject + curriculum
// exactly like the student Overview's subject buttons, so a note filed here
// lands on the matching Overview subject. `sessions` is how many sessions this
// teacher has logged with this student on the subject (a subject only appears
// once the teacher has actually taught it to the student).
interface SubjectOption {
  key: string;
  subjectId: number;
  curriculumId: number | null;
  branch: BranchKey;
  label: string;
  curriculumName: string | null;
  sessions: number;
}

const BRANCH_ICON: Record<BranchKey, React.ReactNode> = {
  academic: <IconBook />,
  beyond_academic: <IconTag />,
  college_counselling: <IconBarChart />,
};
const BRANCH_ACCENT: Record<BranchKey, string> = {
  academic: "bg-green-100 text-green-700",
  beyond_academic: "bg-orange-100 text-orange-700",
  college_counselling: "bg-sky-100 text-sky-700",
};

export default function TeacherNotesPage() {
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();
  const { subjects: allSubjects, loading: subsLoading } = useAllSubjects();
  const { curricula } = useCurricula();
  const { teachers } = useTeachers();

  const [student, setStudent] = useState<Student | null>(null);
  const [branch, setBranch] = useState<BranchKey | null>(null);
  const [subjectKey, setSubjectKey] = useState<string | null>(null);

  // Which sessions make a subject available for notes. A plain teacher only
  // sees subjects from their own sessions with the student (they can note the
  // subjects they actually teach). A Performance Coach oversees every subject
  // for their assigned students but is logged as the *coordinator*, not the
  // session's `teacher_id`, so scoping to their own id would hide everything —
  // they instead see every subject the student has sessions in (RLS already
  // lets a PC read all of a student's session logs and manage all notes).
  const isCoach = teacher?.is_performance_coach === true;
  const { logs, loading: logsLoading } = useSessionLogs(
    {},
    isCoach ? undefined : teacher?.id,
    undefined,
    student ? [student.id] : [],
  );

  const { notes, loading: notesLoading, refetch: refetchNotes, deleteNote } = useSubjectNotes(student?.id ?? null);

  const subjectLookup = useMemo(() => new Map(allSubjects.map((s) => [s.id, s])), [allSubjects]);
  const curriculumLookup = useMemo(() => new Map(curricula.map((c) => [c.id, c.name])), [curricula]);
  const teacherLookup = useMemo(
    () => new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()])),
    [teachers],
  );

  // The subjects this teacher has actually taught the selected student, built
  // from their session logs and bucketed by branch — the note picker only
  // offers these, nothing else.
  const subjectsByBranch = useMemo(() => {
    const byBranch = new Map<BranchKey, SubjectOption[]>();
    const byKey = new Map<string, SubjectOption>();
    for (const log of logs) {
      if (log.subject_id == null) continue;
      const subject: Subject | undefined = subjectLookup.get(log.subject_id);
      if (!subject) continue;
      const key = `${log.subject_id}:${log.curriculum_id ?? ""}`;
      let opt = byKey.get(key);
      if (!opt) {
        const b = branchOfCategory(subject.category);
        opt = {
          key,
          subjectId: log.subject_id,
          curriculumId: log.curriculum_id,
          branch: b,
          label: subjectLabel(subject.name, subject.level),
          curriculumName: log.curriculum_id != null ? curriculumLookup.get(log.curriculum_id) ?? null : null,
          sessions: 0,
        };
        byKey.set(key, opt);
        const arr = byBranch.get(b) ?? [];
        arr.push(opt);
        byBranch.set(b, arr);
      }
      opt.sessions += 1;
    }
    // Busiest subjects first within each branch, then alphabetically.
    for (const arr of byBranch.values()) {
      arr.sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
    }
    return byBranch;
  }, [logs, subjectLookup, curriculumLookup]);

  const availableBranches = BRANCH_ORDER.filter((b) => (subjectsByBranch.get(b)?.length ?? 0) > 0);

  const selectedOption = useMemo(() => {
    if (!branch || !subjectKey) return null;
    return (subjectsByBranch.get(branch) ?? []).find((o) => o.key === subjectKey) ?? null;
  }, [branch, subjectKey, subjectsByBranch]);

  const notesForSubject = useMemo(() => {
    if (!selectedOption) return [];
    return notes.filter(
      (n) =>
        n.subject_id === selectedOption.subjectId &&
        (n.curriculum_id ?? null) === selectedOption.curriculumId,
    );
  }, [notes, selectedOption]);

  function pickStudent(s: Student | null) {
    setStudent(s);
    setBranch(null);
    setSubjectKey(null);
  }

  const loading = teacherLoading || subsLoading;

  return (
    <TeacherLayout>
      <PageHeader
        title="Notes"
        description="Add notes for a student on a subject you've taught them — a written note and/or a file (PDF, doc, image, any format). They appear on the student's Overview for that subject."
      />

      <Card className="p-6 max-w-3xl">
        {loading && (
          <div className="flex items-center gap-2 text-navy-300 text-sm">
            <Spinner /> Loading…
          </div>
        )}

        {teacherError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
            {teacherError}
          </p>
        )}

        {!loading && teacher && (
          <>
            <div className="max-w-md">
              <StudentSearch value={student?.id ?? null} onChange={pickStudent} required />
            </div>

            {student && (
              <div className="mt-6">
                {/* ---- Step 3: chosen subject — add + list notes ---- */}
                {selectedOption ? (
                  <>
                    <BackButton
                      label={`Back to ${BRANCH_TITLES[selectedOption.branch]} subjects`}
                      onClick={() => setSubjectKey(null)}
                    />
                    <p className="font-semibold text-navy-700 text-lg">
                      {selectedOption.curriculumName ? `${selectedOption.curriculumName} · ` : ""}
                      {selectedOption.label}
                    </p>
                    <p className="text-sm text-navy-400 mb-4">
                      Notes for {student.first_name} {student.last_name}
                    </p>

                    <AddSubjectNoteForm
                      key={selectedOption.key}
                      studentId={student.id}
                      teacherId={teacher.id}
                      subjectId={selectedOption.subjectId}
                      curriculumId={selectedOption.curriculumId}
                      onAdded={refetchNotes}
                    />

                    <div className="mt-6">
                      <p className="text-xs font-semibold uppercase tracking-wide text-navy-300 mb-3">
                        Existing notes
                      </p>
                      {notesLoading ? (
                        <div className="flex items-center gap-2 text-navy-300 text-sm">
                          <Spinner /> Loading…
                        </div>
                      ) : (
                        <SubjectNotesList
                          notes={notesForSubject}
                          teacherLookup={teacherLookup}
                          deletableTeacherId={teacher.id}
                          onDelete={async (note) => {
                            await deleteNote(note);
                          }}
                        />
                      )}
                    </div>
                  </>
                ) : branch ? (
                  /* ---- Step 2: pick a subject in the branch ---- */
                  <>
                    <BackButton label="Back to programs" onClick={() => setBranch(null)} />
                    <p className="font-semibold text-navy-700 text-lg mb-3">{BRANCH_TITLES[branch]}</p>
                    {/* Academic keeps its curriculum context — grouped under a
                        per-curriculum heading, same as the student Overview.
                        Beyond Academic / College Counselling stay flat. */}
                    {branch === "academic" ? (
                      <AcademicSubjectGroups
                        options={subjectsByBranch.get(branch) ?? []}
                        onOpen={setSubjectKey}
                      />
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {(subjectsByBranch.get(branch) ?? []).map((o) => (
                          <SubjectButton key={o.key} option={o} onOpen={() => setSubjectKey(o.key)} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  /* ---- Step 1: pick a program ---- */
                  <>
                    <p className="text-sm text-navy-500 mb-3">
                      Pick a program, then a subject you've taught {student.first_name}.
                    </p>
                    {logsLoading ? (
                      <div className="flex items-center gap-2 text-navy-300 text-sm">
                        <Spinner /> Loading…
                      </div>
                    ) : availableBranches.length === 0 ? (
                      <p className="text-sm text-navy-400">
                        You haven't logged any sessions with {student.first_name} yet — a subject
                        becomes available for notes once you've taught it to them.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {availableBranches.map((b) => {
                          const count = subjectsByBranch.get(b)?.length ?? 0;
                          return (
                            <button
                              key={b}
                              onClick={() => setBranch(b)}
                              className="text-left bg-white rounded-2xl border border-navy-100 shadow-sm p-5 hover:border-sky-300 hover:bg-sky-50/40 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300"
                            >
                              <span
                                className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${BRANCH_ACCENT[b]}`}
                              >
                                {BRANCH_ICON[b]}
                              </span>
                              <p className="font-semibold text-navy-700">{BRANCH_TITLES[b]}</p>
                              <p className="text-xs text-navy-400 mt-1">
                                {count} {count === 1 ? "subject" : "subjects"}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Card>
    </TeacherLayout>
  );
}

function SubjectButton({ option, onOpen }: { option: SubjectOption; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="text-left border border-navy-100 rounded-xl p-4 hover:border-sky-300 hover:bg-sky-50/40 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300"
    >
      <p className="font-semibold text-navy-700">{option.label}</p>
      <p className="text-xs text-navy-400 mt-1">
        {option.sessions} {option.sessions === 1 ? "session" : "sessions"}
      </p>
    </button>
  );
}

// Academic subjects grouped under a per-curriculum heading, matching the
// student Overview's AcademicSubjectGroups.
function AcademicSubjectGroups({
  options,
  onOpen,
}: {
  options: SubjectOption[];
  onOpen: (key: string) => void;
}) {
  const groups = new Map<string, { label: string; options: SubjectOption[] }>();
  for (const opt of options) {
    const gkey = opt.curriculumId != null ? String(opt.curriculumId) : "__other__";
    const label = opt.curriculumName ?? "Other";
    const g = groups.get(gkey) ?? { label, options: [] };
    g.options.push(opt);
    groups.set(gkey, g);
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="space-y-5">
      {sortedGroups.map((g) => (
        <div key={g.label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400 mb-2">{g.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {g.options.map((o) => (
              <SubjectButton key={o.key} option={o} onOpen={() => onOpen(o.key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600 mb-4"
    >
      <IconArrowLeft />
      {label}
    </button>
  );
}


import { useEffect, useRef, useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { SelectInput } from "../ui/Input";
import { SubjectLevelSelect } from "../ui/SubjectLevelSelect";
import { BeyondAcademicSubjectSelect, type BeyondAcademicOption } from "../ui/BeyondAcademicSubjectSelect";
import { useTeacherSubjects } from "../../hooks/useTeachers";
import { subjectDisplayLabel } from "../../hooks/useCurriculumGroups";
import type { Subject, Curriculum, SubjectCategory, CurriculumGroup } from "../../types/database";

type Category = "academic" | "beyond_academic" | "college_counselling";

/**
 * Shared "assign/remove subjects for a teacher" widget used by BOTH the
 * admin (`AdminTeacherSubjectsPage.tsx`'s per-teacher `SubjectEditor`,
 * picking any teacher from a list) and the teacher's own self-service page
 * (`TeacherSubjectsPage.tsx`, operating on themselves) — one component so
 * the cascading Curriculum → Group → Subject picker, the flat Beyond
 * Academic picker, and the auto-assign-ungrouped-curriculum logic can't
 * drift apart again (they were copy-pasted near-verbatim, including
 * comments, before this). The two roles differ ONLY in:
 *   - `onSubjectsChanged` — admin needs this to refresh its outer
 *     per-teacher list cache (`refetchAllSubjects`) after an add/remove;
 *     the teacher's own page has no such outer cache to refresh, so it's
 *     optional and simply omitted there;
 *   - `variant` — controls the "assigned subjects" presentation only
 *     (admin: white pills with an explicit "(inactive)" text label, inside
 *     a bordered/tinted Card with a "Subjects for {name}" header; teacher:
 *     blue-tinted pills for inactive subjects plus a color legend below,
 *     no card wrapper since it's already embedded in the page's own Card)
 *     — preserved pixel-for-pixel as each role already rendered it, not a
 *     new design.
 */
export function TeacherSubjectEditor({
  teacherId,
  allSubjects,
  curricula,
  allGroups,
  academicCategories,
  createSubject,
  onSubjectsChanged,
  variant,
  header,
}: {
  teacherId: number;
  allSubjects: Subject[];
  curricula: Curriculum[];
  allGroups: CurriculumGroup[];
  academicCategories: SubjectCategory[];
  createSubject: (input: { name: string; category: string; category_id?: number; curriculum_group_id?: number; curriculum_id?: number }) => Promise<{ data: Subject | null; error: string | null }>;
  onSubjectsChanged?: () => void;
  variant: "admin" | "teacher";
  header?: React.ReactNode;
}) {
  const { subjects, addSubject, removeSubject } = useTeacherSubjects(teacherId);
  const [category, setCategory] = useState<Category | "">("");
  const [beyondSubjectId, setBeyondSubjectId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingBeyond, setSavingBeyond] = useState(false);
  const [collegeCounsellingSubjectId, setCollegeCounsellingSubjectId] = useState("");
  const [savingCollegeCounselling, setSavingCollegeCounselling] = useState(false);

  // Academic dropdown state: Curriculum -> Subject group -> Subject (+ Level)
  const [academicCurriculumId, setAcademicCurriculumId] = useState("");
  const [academicGroupId, setAcademicGroupId] = useState("");
  const [academicSubjectId, setAcademicSubjectId] = useState("");
  const [savingAcademic, setSavingAcademic] = useState(false);

  const assignedKeys = new Set(subjects.map((s) => `${s.subject_id}:${s.curriculum_id ?? ""}`));
  const activeCurricula = curricula.filter((c) => c.is_active);
  const activeSubjects = allSubjects.filter((s) => s.is_active);

  const academicCurriculumGroups = academicCurriculumId
    ? allGroups.filter((g) => g.is_active && String(g.curriculum_id) === academicCurriculumId)
    : [];
  const academicGroupSubjects = academicGroupId
    ? activeSubjects.filter(
        (s) => String(s.curriculum_group_id) === academicGroupId && !assignedKeys.has(`${s.id}:${academicCurriculumId}`)
      )
    : [];

  // Some curricula (e.g. "Standard Tests") have no groups at all; their
  // subjects sit directly under the curriculum instead.
  const academicCurriculumHasGroups = academicCurriculumGroups.length > 0;
  // All subjects under this curriculum, regardless of whether they're
  // already assigned to this teacher — used to tell "nothing exists here at
  // all" apart from "everything here is already assigned".
  const academicAllDirectSubjects = academicCurriculumId && !academicCurriculumHasGroups
    ? activeSubjects.filter((s) => String(s.curriculum_id) === academicCurriculumId)
    : [];
  const academicDirectSubjects = academicAllDirectSubjects.filter(
    (s) => !assignedKeys.has(`${s.id}:${academicCurriculumId}`)
  );
  const academicCurriculumHasNoSubjectsAtAll = Boolean(academicCurriculumId) && !academicCurriculumHasGroups && academicAllDirectSubjects.length === 0;
  const selectedAcademicCurriculum = academicCurriculumId
    ? curricula.find((c) => String(c.id) === academicCurriculumId) ?? null
    : null;

  // Beyond Academics subjects sit directly under Beyond Academics — one flat
  // list, no sections/categories at all. category_id is only ever non-null
  // now for subjects left behind under legacy, deactivated categories
  // (Computer Science, Music, …) — exclude those rather than resurfacing them.
  // College Counselling subjects are also excluded here even though they
  // aren't 'academic' either — they get their own flat picker below.
  const beyondOptions: BeyondAcademicOption[] = activeSubjects
    .filter((s) => s.category !== "academic" && s.category !== "college_counselling" && s.category_id == null && !assignedKeys.has(`${s.id}:`))
    .map((s) => ({ value: String(s.id), label: s.name }));

  // College Counselling subjects (College Counselling, College Essays) sit
  // directly under it — same flat, no-grouping picker as Beyond Academics.
  const collegeCounsellingOptions: BeyondAcademicOption[] = activeSubjects
    .filter((s) => s.category === "college_counselling" && !assignedKeys.has(`${s.id}:`))
    .map((s) => ({ value: String(s.id), label: s.name }));

  function handleCategoryChange(cat: Category) {
    setCategory(cat);
    setBeyondSubjectId("");
    setCollegeCounsellingSubjectId("");
    setActionError(null);
    setAcademicCurriculumId("");
    setAcademicGroupId("");
    setAcademicSubjectId("");
  }

  async function handleAddAcademic() {
    if (!academicSubjectId || !academicCurriculumId) return;
    setSavingAcademic(true);
    setActionError(null);
    const { error } = await addSubject(Number(academicSubjectId), Number(academicCurriculumId));
    if (error) setActionError(error);
    else { setAcademicSubjectId(""); onSubjectsChanged?.(); }
    setSavingAcademic(false);
  }

  // For an ungrouped curriculum with no subjects at all, assign the teacher
  // straight to the curriculum itself automatically — no confirmation needed.
  const autoUsedCurriculumRef = useRef<string | null>(null);
  async function handleUseCurriculumAsSubject() {
    if (!academicCurriculumId || !selectedAcademicCurriculum) return;
    setSavingAcademic(true);
    setActionError(null);
    const { data, error } = await createSubject({
      name: selectedAcademicCurriculum.name,
      category: "academic",
      category_id: academicCategories[0]?.id,
      curriculum_id: Number(academicCurriculumId),
    });
    if (error || !data) {
      setActionError(error ?? "Could not create the subject.");
      setSavingAcademic(false);
      return;
    }
    const { error: assignErr } = await addSubject(data.id, Number(academicCurriculumId));
    setSavingAcademic(false);
    if (assignErr) setActionError(assignErr);
    else onSubjectsChanged?.();
  }

  useEffect(() => {
    if (!academicCurriculumHasNoSubjectsAtAll) return;
    if (autoUsedCurriculumRef.current === academicCurriculumId) return;
    autoUsedCurriculumRef.current = academicCurriculumId;
    handleUseCurriculumAsSubject();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicCurriculumHasNoSubjectsAtAll, academicCurriculumId]);

  async function handleAddBeyond() {
    if (!beyondSubjectId) return;
    setSavingBeyond(true);
    setActionError(null);
    const { error } = await addSubject(Number(beyondSubjectId), null);
    if (error) setActionError(error);
    else { setBeyondSubjectId(""); onSubjectsChanged?.(); }
    setSavingBeyond(false);
  }

  async function handleAddCollegeCounselling() {
    if (!collegeCounsellingSubjectId) return;
    setSavingCollegeCounselling(true);
    setActionError(null);
    const { error } = await addSubject(Number(collegeCounsellingSubjectId), null);
    if (error) setActionError(error);
    else { setCollegeCounsellingSubjectId(""); onSubjectsChanged?.(); }
    setSavingCollegeCounselling(false);
  }

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

  async function handleRemove(id: number) {
    await removeSubject(id);
    onSubjectsChanged?.();
  }

  const picker = (
    <>
      {/* Category picker */}
      <div className={`flex gap-2 ${variant === "admin" ? "mb-3" : "mb-4"}`}>
        <button
          type="button"
          onClick={() => handleCategoryChange("academic")}
          className={`rounded-lg font-medium border transition-colors ${variant === "admin" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} ${
            category === "academic"
              ? "bg-sky-500 text-white border-sky-500"
              : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
          }`}
        >
          Academic
        </button>
        <button
          type="button"
          onClick={() => handleCategoryChange("beyond_academic")}
          className={`rounded-lg font-medium border transition-colors ${variant === "admin" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} ${
            category === "beyond_academic"
              ? "bg-sky-500 text-white border-sky-500"
              : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
          }`}
        >
          Beyond Academics
        </button>
        <button
          type="button"
          onClick={() => handleCategoryChange("college_counselling")}
          className={`rounded-lg font-medium border transition-colors ${variant === "admin" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} ${
            category === "college_counselling"
              ? "bg-sky-500 text-white border-sky-500"
              : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
          }`}
        >
          College Counselling
        </button>
      </div>

      {/* Academic — cascading dropdowns: Curriculum -> Subject group -> Subject (+ Level) */}
      {category === "academic" && (
        <div className={`flex flex-col gap-2 max-w-sm ${variant === "teacher" ? "mb-4" : ""}`}>
          {activeCurricula.length === 0 && (
            <p className="text-navy-300 text-sm">No curricula have been set up yet.</p>
          )}
          {activeCurricula.length > 0 && (
            <>
              <SelectInput
                label="Curriculum"
                placeholder="Select curriculum…"
                value={academicCurriculumId}
                onChange={(e) => { setAcademicCurriculumId(e.target.value); setAcademicGroupId(""); setAcademicSubjectId(""); setActionError(null); }}
                options={activeCurricula.map((c) => ({ value: String(c.id), label: c.name }))}
              />
              {academicCurriculumId && academicCurriculumHasGroups && (
                <SelectInput
                  label="Subject group"
                  placeholder="Select subject group…"
                  value={academicGroupId}
                  onChange={(e) => { setAcademicGroupId(e.target.value); setAcademicSubjectId(""); setActionError(null); }}
                  options={academicCurriculumGroups.map((g) => ({ value: String(g.id), label: g.name }))}
                />
              )}

              {/* Ungrouped curriculum (e.g. Standard Tests) — no group step;
                  subjects sit directly under the curriculum. With zero
                  subjects at all, it's auto-assigned as its own standalone
                  subject (see the effect above) — no confirmation needed. */}
              {academicCurriculumId && !academicCurriculumHasGroups && (
                academicCurriculumHasNoSubjectsAtAll ? (
                  <p className="text-sm text-navy-400 italic">
                    {savingAcademic
                      ? `Setting up "${selectedAcademicCurriculum?.name}"…`
                      : `"${selectedAcademicCurriculum?.name}" has no subjects of its own, so it's assigned directly.`}
                  </p>
                ) : academicDirectSubjects.length === 0 ? (
                  <p className="text-sm text-navy-400 italic">
                    Every subject under {selectedAcademicCurriculum?.name} is already assigned to {variant === "admin" ? "this teacher" : "you"}.
                  </p>
                ) : (
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <SubjectLevelSelect
                        subjects={academicDirectSubjects}
                        value={academicSubjectId}
                        onChange={(v) => { setAcademicSubjectId(v); setActionError(null); }}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddAcademic}
                      disabled={savingAcademic || !academicSubjectId}
                      className="mb-0.5"
                    >
                      {savingAcademic ? "Adding…" : "Add"}
                    </Button>
                  </div>
                )
              )}
              {academicGroupId && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <SubjectLevelSelect
                      subjects={academicGroupSubjects}
                      value={academicSubjectId}
                      onChange={(v) => { setAcademicSubjectId(v); setActionError(null); }}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddAcademic}
                    disabled={savingAcademic || !academicSubjectId}
                    className="mb-0.5"
                  >
                    {savingAcademic ? "Adding…" : "Add"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Beyond Academics: subjects sit directly under it — one flat
          dropdown, no sections/categories at all. */}
      {category === "beyond_academic" && (
        <div className={variant === "teacher" ? "flex flex-col gap-3 mb-4 max-w-sm" : "flex flex-col gap-2 max-w-sm"}>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <BeyondAcademicSubjectSelect
                options={beyondOptions}
                value={beyondSubjectId}
                onChange={variant === "admin" ? (v) => { setBeyondSubjectId(v); setActionError(null); } : setBeyondSubjectId}
              />
            </div>
            <Button type="button" size="sm" onClick={handleAddBeyond} disabled={savingBeyond || !beyondSubjectId} className="mb-0.5">
              Add
            </Button>
          </div>
        </div>
      )}

      {/* College Counselling: subjects (College Counselling, College
          Essays) sit directly under it — same flat picker as Beyond
          Academics, no sections/categories at all. */}
      {category === "college_counselling" && (
        <div className={variant === "teacher" ? "flex flex-col gap-3 mb-4 max-w-sm" : "flex flex-col gap-2 max-w-sm"}>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <BeyondAcademicSubjectSelect
                options={collegeCounsellingOptions}
                value={collegeCounsellingSubjectId}
                onChange={variant === "admin" ? (v) => { setCollegeCounsellingSubjectId(v); setActionError(null); } : setCollegeCounsellingSubjectId}
              />
            </div>
            <Button type="button" size="sm" onClick={handleAddCollegeCounselling} disabled={savingCollegeCounselling || !collegeCounsellingSubjectId} className="mb-0.5">
              Add
            </Button>
          </div>
        </div>
      )}

    </>
  );

  if (variant === "admin") {
    return (
      <Card className="p-5 mt-4 border border-sky-100 bg-sky-50/40">
        {header}
        {/* Assigned subject pills */}
        <div className="flex flex-wrap gap-2 mb-4 min-h-[32px]">
          {subjects.length === 0 && (
            <p className="text-navy-300 text-sm">No subjects added yet.</p>
          )}
          {subjects.map((s) => {
            const subject = allSubjects.find((x) => x.id === s.subject_id);
            const isInactive = subject ? !subject.is_active : false;
            const label = getLabel(s.subject_id, s.curriculum_id);
            return (
              <span
                key={s.id}
                className={`inline-flex items-center gap-2 rounded-pill border px-3 py-1 text-sm shadow-sm whitespace-nowrap ${
                  isInactive
                    ? "bg-navy-50 border-navy-100 text-navy-300"
                    : "bg-white border-navy-100 text-navy-700"
                }`}
                title={isInactive ? "Subject is deactivated" : undefined}
              >
                {label}
                {isInactive && <span className="text-xs font-medium text-navy-300">(inactive)</span>}
                <button
                  type="button"
                  onClick={() => handleRemove(s.id)}
                  className="text-navy-300 hover:text-red-500 leading-none"
                  aria-label={`Remove ${label}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        {picker}
        {actionError && <p className="text-xs text-red-600 mt-2">{actionError}</p>}
      </Card>
    );
  }

  return (
    <>
      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          {actionError}
        </p>
      )}
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-300 mb-2">
        Add a subject
      </p>
      {picker}
      {/* Assigned subjects */}
      {subjects.length === 0 ? (
        <p className="text-navy-300 text-sm mt-2">No subjects added yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mt-2">
            {subjects.map((s) => {
              const subj = allSubjects.find((x) => x.id === s.subject_id);
              const isInactive = subj ? !subj.is_active : false;
              return (
                <span
                  key={s.id}
                  className={`inline-flex items-center gap-2 rounded-pill px-4 py-1.5 text-sm font-medium max-w-full border ${
                    isInactive
                      ? "bg-blue-50 text-blue-400 border-blue-200"
                      : "bg-navy-50 text-navy-600 border-navy-100"
                  }`}
                  title={isInactive ? "This subject is no longer active" : undefined}
                >
                  <span>{getLabel(s.subject_id, s.curriculum_id)}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(s.id)}
                    className="text-navy-300 hover:text-red-500 leading-none flex-shrink-0"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>

          {/* Color legend */}
          {subjects.some((s) => {
            const subj = allSubjects.find((x) => x.id === s.subject_id);
            return subj && !subj.is_active;
          }) && (
            <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-navy-50">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-300 w-full mb-1">Legend</p>
              <div className="flex items-center gap-1.5 text-xs text-navy-500">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-blue-300 bg-blue-50" />
                Blue — subject is no longer active
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

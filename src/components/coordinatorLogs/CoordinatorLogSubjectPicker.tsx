import { useState } from "react";
import { Button } from "../ui/Button";
import { SelectInput, TextInput } from "../ui/Input";
import { SubjectLevelSelect } from "../ui/SubjectLevelSelect";
import { BeyondAcademicSubjectSelect, type BeyondAcademicOption } from "../ui/BeyondAcademicSubjectSelect";
import type { Subject, Curriculum, CurriculumGroup } from "../../types/database";
import type { CoordinatorLogSubjectInput } from "../../hooks/useCoordinatorLogs";

export type SubjectCategory = "academic" | "beyond_academic" | "college_counselling";

// Shared short-date formatter for a subject's baseline date (dd Mon yyyy).
export function fmtBaselineDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

// Baseline score with its date inline in brackets, e.g. "5 (16 Jul 2026)" —
// shown as one value instead of a separate Baseline Date column.
export function baselineWithDate(score: string | null | undefined, date: string | null | undefined) {
  if (score == null || score === "") return "—";
  return date ? `${score} (${fmtBaselineDate(date)})` : score;
}

// Which bucket a subject falls into, derived from the subjects catalogue:
// college_counselling by its slug; Beyond Academic = anything non-academic
// with no academic category_id (Passion Projects, Career Exploration, …);
// everything else (real academic subjects, or anything carrying an academic
// category_id) is academic. Mirrors the filters used to build the pickers
// below, and lets read/write code split a log's flat subject list back into
// its Academic / Profile-Building / College-Counselling groups.
export function subjectCategoryOf(subjectId: number, allSubjects: Subject[]): SubjectCategory {
  const sub = allSubjects.find((s) => s.id === subjectId);
  if (!sub) return "academic";
  if (sub.category === "college_counselling") return "college_counselling";
  if (sub.category !== "academic" && sub.category_id == null) return "beyond_academic";
  return "academic";
}

export function subjectRowLabel(
  subjectId: number,
  curriculumId: number | null,
  allSubjects: Subject[],
  curricula: Curriculum[],
  allGroups: CurriculumGroup[],
): string {
  const sub = allSubjects.find((s) => s.id === subjectId);
  if (!sub) return `#${subjectId}`;
  const cur = curriculumId ? curricula.find((c) => c.id === curriculumId) : null;
  const group = sub.curriculum_group_id ? allGroups.find((g) => g.id === sub.curriculum_group_id) : null;
  const parts: string[] = [];
  if (cur) parts.push(cur.name);
  if (group) parts.push(group.name);
  parts.push(sub.level ? `${sub.name} — ${sub.level}` : sub.name);
  return parts.join(" | ");
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">{children}</h3>;
}

// A row from the log's flat subject list, paired with its index in that list
// so a block can remove exactly its own row without touching the others.
type IndexedRow = { row: CoordinatorLogSubjectInput; index: number };

// Flat, no-baseline picker shared by the Profile Building (Beyond Academic)
// and College Counselling blocks — a single dropdown + Add, then a removable
// list. These subjects carry no baseline/grade improvement (that's academic
// only), so they're added with baseline_score/final_outcome_grade = null.
function FlatSubjectBlock({
  label,
  placeholder,
  options,
  rows,
  allSubjects,
  curricula,
  allGroups,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  options: BeyondAcademicOption[];
  rows: IndexedRow[];
  allSubjects: Subject[];
  curricula: Curriculum[];
  allGroups: CurriculumGroup[];
  onAdd: (subjectId: number) => void;
  onRemove: (index: number) => void;
}) {
  const [subjectId, setSubjectId] = useState("");
  const chosen = new Set(rows.map(({ row }) => String(row.subject_id)));
  const available = options.filter((o) => !chosen.has(o.value));

  function handleAdd() {
    if (!subjectId) return;
    onAdd(Number(subjectId));
    setSubjectId("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <BeyondAcademicSubjectSelect label={label} placeholder={placeholder} options={available} value={subjectId} onChange={setSubjectId} />
        </div>
        <Button type="button" size="sm" onClick={handleAdd} disabled={!subjectId} className="mb-0.5">+ Add</Button>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-navy-100">
          <table className="min-w-full text-sm">
            <tbody>
              {rows.map(({ row, index }) => (
                <tr key={index} className="border-t border-navy-50 first:border-t-0">
                  <td className="px-4 py-2 font-medium text-navy-700">
                    {subjectRowLabel(row.subject_id, row.curriculum_id, allSubjects, curricula, allGroups)}
                  </td>
                  <td className="px-4 py-2 text-right w-10">
                    <button type="button" onClick={() => onRemove(index)} className="text-navy-300 hover:text-red-400 text-lg leading-none" aria-label="Remove subject">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The combined "Subjects & Profile Building" body. Which blocks show is driven
// by the log's selected programs (Course Types):
//   • Academic  → Academic Subjects & Baseline Scores (the only block with baselines)
//   • Beyond Academic / Foundation Program / All-In-One → Profile Building Project
//     (a flat Beyond Academic subject picker — the subjects *are* the project)
//   • College Counselling / All-In-One → College Counselling subjects
// All picked subjects live in one flat list (value); College Counselling
// subjects are stored alongside the Profile Building ones (no baseline).
export function CoordinatorLogSubjectPicker({
  allSubjects,
  curricula,
  allGroups,
  showAcademic,
  showProfileBuilding,
  showCollegeCounselling,
  value,
  onChange,
}: {
  allSubjects: Subject[];
  curricula: Curriculum[];
  allGroups: CurriculumGroup[];
  showAcademic: boolean;
  showProfileBuilding: boolean;
  showCollegeCounselling: boolean;
  value: CoordinatorLogSubjectInput[];
  onChange: (next: CoordinatorLogSubjectInput[]) => void;
}) {
  // Academic cascade state (curriculum → group → subject) + baseline.
  const [curriculumId, setCurriculumId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [baselineScore, setBaselineScore] = useState("");

  const activeCurricula = curricula.filter((c) => c.is_active);
  const activeSubjects = allSubjects.filter((s) => s.is_active);

  const indexed: IndexedRow[] = value.map((row, index) => ({ row, index }));
  const rowsIn = (cat: SubjectCategory) => indexed.filter(({ row }) => subjectCategoryOf(row.subject_id, allSubjects) === cat);
  const academicRows = rowsIn("academic");
  const beyondRows = rowsIn("beyond_academic");
  const collegeRows = rowsIn("college_counselling");

  const curriculumGroups = curriculumId
    ? allGroups.filter((g) => g.is_active && String(g.curriculum_id) === curriculumId)
    : [];
  const hasGroups = curriculumGroups.length > 0;
  const groupSubjects = groupId ? activeSubjects.filter((s) => String(s.curriculum_group_id) === groupId) : [];
  const directSubjects = curriculumId && !hasGroups
    ? activeSubjects.filter((s) => String(s.curriculum_id) === curriculumId)
    : [];

  const beyondOptions: BeyondAcademicOption[] = activeSubjects
    .filter((s) => s.category !== "academic" && s.category !== "college_counselling" && s.category_id == null)
    .map((s) => ({ value: String(s.id), label: s.name }));
  const collegeCounsellingOptions: BeyondAcademicOption[] = activeSubjects
    .filter((s) => s.category === "college_counselling")
    .map((s) => ({ value: String(s.id), label: s.name }));

  const academicKeys = new Set(academicRows.map(({ row }) => `${row.subject_id}:${row.curriculum_id ?? ""}`));

  function handleAcademicAdd() {
    if (!subjectId) return;
    const cid = curriculumId ? Number(curriculumId) : null;
    if (academicKeys.has(`${subjectId}:${cid ?? ""}`)) return;
    const score = baselineScore.trim() || null;
    // The baseline date is stamped automatically as today — the day it's
    // recorded — rather than asked for.
    const today = new Date().toISOString().slice(0, 10);
    onChange([...value, { subject_id: Number(subjectId), curriculum_id: cid, baseline_score: score, baseline_score_date: score ? today : null, final_outcome_grade: null }]);
    setGroupId("");
    setSubjectId("");
    setBaselineScore("");
  }

  function addFlat(sid: number) {
    if (value.some((v) => v.subject_id === sid)) return;
    onChange([...value, { subject_id: sid, curriculum_id: null, baseline_score: null, baseline_score_date: null, final_outcome_grade: null }]);
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  const canAddAcademic = !!subjectId;

  if (!showAcademic && !showProfileBuilding && !showCollegeCounselling) {
    return <p className="text-sm text-navy-300">Select a program above to add subjects.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {showAcademic && (
        <div className="flex flex-col gap-3">
          <SubHeading>Academic Subjects &amp; Baseline Scores</SubHeading>
          {activeCurricula.length === 0 ? (
            <p className="text-sm text-navy-300">No curricula have been set up yet.</p>
          ) : (
            <>
              <SelectInput
                label="Curriculum"
                placeholder="Select curriculum…"
                value={curriculumId}
                onChange={(e) => { setCurriculumId(e.target.value); setGroupId(""); setSubjectId(""); }}
                options={activeCurricula.map((c) => ({ value: String(c.id), label: c.name }))}
              />
              {curriculumId && hasGroups && (
                <SelectInput
                  label="Subject group"
                  placeholder="Select subject group…"
                  value={groupId}
                  onChange={(e) => { setGroupId(e.target.value); setSubjectId(""); }}
                  options={curriculumGroups.map((g) => ({ value: String(g.id), label: g.name }))}
                />
              )}
              {(groupId || (curriculumId && !hasGroups)) && (
                <SubjectLevelSelect
                  subjects={groupId ? groupSubjects : directSubjects}
                  value={subjectId}
                  onChange={setSubjectId}
                />
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <TextInput
                    label="Baseline score"
                    placeholder="e.g. C+, 65%, IB 5…"
                    value={baselineScore}
                    onChange={(e) => setBaselineScore(e.target.value)}
                  />
                </div>
                <Button type="button" size="sm" onClick={handleAcademicAdd} disabled={!canAddAcademic} className="mb-0.5">+ Add subject</Button>
              </div>
            </>
          )}

          {academicRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-navy-100">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-navy-50 text-left text-xs font-semibold text-navy-500 uppercase tracking-wide">
                    <th className="px-4 py-2">Subject</th>
                    <th className="px-4 py-2">Baseline Score</th>
                    <th className="px-4 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {academicRows.map(({ row, index }) => (
                    <tr key={index} className="border-t border-navy-50">
                      <td className="px-4 py-2 font-medium text-navy-700">
                        {subjectRowLabel(row.subject_id, row.curriculum_id, allSubjects, curricula, allGroups)}
                      </td>
                      <td className="px-4 py-2 text-navy-600 whitespace-nowrap">{baselineWithDate(row.baseline_score, row.baseline_score_date)}</td>
                      <td className="px-4 py-2 text-right">
                        <button type="button" onClick={() => removeAt(index)} className="text-navy-300 hover:text-red-400 text-lg leading-none" aria-label="Remove subject">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showProfileBuilding && (
        <div className="flex flex-col gap-3">
          <SubHeading>Profile Building Project</SubHeading>
          <FlatSubjectBlock
            label="Beyond Academic subject"
            placeholder="Select a subject…"
            options={beyondOptions}
            rows={beyondRows}
            allSubjects={allSubjects}
            curricula={curricula}
            allGroups={allGroups}
            onAdd={addFlat}
            onRemove={removeAt}
          />
        </div>
      )}

      {showCollegeCounselling && (
        <div className="flex flex-col gap-3">
          <SubHeading>College Counselling</SubHeading>
          <FlatSubjectBlock
            label="College Counselling subject"
            placeholder="Select a subject…"
            options={collegeCounsellingOptions}
            rows={collegeRows}
            allSubjects={allSubjects}
            curricula={curricula}
            allGroups={allGroups}
            onAdd={addFlat}
            onRemove={removeAt}
          />
        </div>
      )}
    </div>
  );
}

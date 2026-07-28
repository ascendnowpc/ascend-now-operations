import { useState } from "react";
import { SubjectLevelSelect } from "../ui/SubjectLevelSelect";
import type { Subject, Curriculum, CurriculumGroup } from "../../types/database";

interface Props {
  curricula: Curriculum[];
  allGroups: CurriculumGroup[];
  subjects: Subject[];
  curriculumId: number | null;
  subjectId: number | null;
  onChange: (next: { curriculumId: number | null; subjectId: number | null }) => void;
  compact?: boolean;
  // When true, curriculumId is already decided by the caller (e.g. a "type"
  // step picked "IBDP" before this component rendered) — hide the Curriculum
  // dropdown and only ask Group -> Subject -> Level for that fixed curriculum.
  lockCurriculum?: boolean;
}

// Curriculum -> (Group ->) Subject -> Level picker for the Homework Generator,
// following the app's canonical academic hierarchy (see SUBJECT_HIERARCHY.md):
// subjects sit under a curriculum_group for grouped curricula, or directly under
// the curriculum for ungrouped ones (e.g. Standard Tests). SL/HL is the second
// step inside SubjectLevelSelect since those are separate subjects rows. The
// resolved subject (which encodes the level) drives which style-template variant
// generation uses for this paper/block.
export function AcademicSubjectPicker({
  curricula,
  allGroups,
  subjects,
  curriculumId,
  subjectId,
  onChange,
  compact,
  lockCurriculum,
}: Props) {
  // Defensive is_active filter here too (not just on groups/subjects below) —
  // callers may pass the admin-management "all curricula" list (which
  // deliberately includes inactive/retired ones for edit screens), but this is
  // a teacher-facing picker and must only ever offer live curricula.
  const activeCurricula = curricula.filter((c) => c.is_active);

  const groups = curriculumId
    ? allGroups.filter((g) => g.curriculum_id === curriculumId && g.is_active)
    : [];
  const hasGroups = groups.length > 0;

  const selectedSubject = subjects.find((s) => s.id === subjectId) ?? null;
  // Group selection is local UI state; when a subject is already set (e.g.
  // prefilled from a session log) derive the group from it so the dropdowns
  // reflect it without an effect.
  const [groupOverride, setGroupOverride] = useState<number | null>(null);
  const activeGroupId = groupOverride ?? selectedSubject?.curriculum_group_id ?? null;

  const pickerSubjects = subjects.filter((s) => {
    if (s.category !== "academic") return false;
    if (s.is_active === false) return false;
    if (!curriculumId) return false;
    return hasGroups ? s.curriculum_group_id === activeGroupId : s.curriculum_id === curriculumId;
  });

  const selectClass =
    "rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300";

  return (
    <div className={compact ? "flex flex-col gap-2" : "grid gap-3 sm:grid-cols-2"}>
      {!lockCurriculum && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">Curriculum</label>
          <select
            value={curriculumId ?? ""}
            onChange={(e) => {
              setGroupOverride(null);
              onChange({
                curriculumId: e.target.value ? Number(e.target.value) : null,
                subjectId: null,
              });
            }}
            className={selectClass}
          >
            <option value="">Select curriculum…</option>
            {activeCurricula.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {curriculumId != null && hasGroups && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">Subject group</label>
          <select
            value={activeGroupId ?? ""}
            onChange={(e) => {
              setGroupOverride(e.target.value ? Number(e.target.value) : null);
              onChange({ curriculumId, subjectId: null });
            }}
            className={selectClass}
          >
            <option value="">Select group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {curriculumId != null && (!hasGroups || activeGroupId != null) && (
        <div className={compact ? "" : "sm:col-span-2"}>
          <SubjectLevelSelect
            subjects={pickerSubjects}
            value={subjectId != null ? String(subjectId) : ""}
            onChange={(sid) => onChange({ curriculumId, subjectId: sid ? Number(sid) : null })}
          />
        </div>
      )}
    </div>
  );
}

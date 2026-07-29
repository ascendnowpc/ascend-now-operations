import { useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/Input";
import { IconPlus } from "../ui/icons";
import { Spinner } from "../ui/Spinner";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { RowMenu } from "../ui/RowMenu";
import { useAllCurricula } from "../../hooks/useCurricula";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useAllSubjectCategories } from "../../hooks/useSubjectCategories";
import { useAllCurriculumGroups, subjectBaseLabel, groupSubjectsByBase } from "../../hooks/useCurriculumGroups";
import { useTeacherNames } from "../../hooks/useTeacherNames";
import type { Curriculum, Subject, SubjectCategory, CurriculumGroup } from "../../types/database";

type Tab = "academics" | "beyond_academics" | "college_counselling" | "inactive";
type Mode = "normal" | "edit" | "deactivate";

// A subject is added either under a group, or (for curricula with no groups,
// e.g. ACT/SAT/TOEFL/IELTS) directly under the curriculum.
type AddSubjectTarget = { kind: "group" | "curriculum"; id: number };

// ---------------------------------------------------------------------------
// SubjectEditRow — inline edit for a single subject in the academics table
// ---------------------------------------------------------------------------

function SubjectEditRow({
  subject, onSave, onDeactivate, teacherLookup, displayLabel,
}: {
  subject: Subject;
  onSave: (id: number, input: Partial<Subject>) => Promise<{ data: Subject | null; error: string | null }>;
  onDeactivate: () => void;
  teacherLookup?: Map<string, string>;
  /** Override the row's display label (used when nested under a subject group header, e.g. just "Higher Level"). */
  displayLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: subject.name,
    board: subject.board ?? "",
    code: subject.subject_code ?? "",
    level: subject.level ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(subject.id, {
      name: form.name.trim() || subject.name,
      board: form.board.trim() || null,
      subject_code: form.code.trim() || null,
      level: form.level.trim() || null,
    });
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="px-4 py-3 rounded-xl border border-sky-200 bg-sky-50/50 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Subject name *"
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <input
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
            placeholder="Level (e.g. Standard Level)"
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <input
            value={form.board}
            onChange={(e) => setForm((f) => ({ ...f, board: e.target.value }))}
            placeholder="Board (e.g. Cambridge)"
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            placeholder="Subject code (e.g. 9700)"
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => {
            setEditing(false);
            setForm({ name: subject.name, board: subject.board ?? "", code: subject.subject_code ?? "", level: subject.level ?? "" });
          }}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white border-navy-100">
      <span className="text-sm text-navy-700 flex-1 min-w-0 truncate">
        {displayLabel ?? subjectBaseLabel(subject.name, subject.board, subject.subject_code)}
      </span>
      {subject.added_by_teacher_id != null && !subject.acknowledged_at && (
        <span
          className="inline-flex items-center gap-1 rounded-pill bg-red-50 text-red-500 border border-red-200 px-2 py-0.5 text-xs font-semibold flex-shrink-0"
          title={`Added by teacher — pending PC review`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
          {teacherLookup?.get(subject.added_by_teacher_id)
            ? `Added by ${teacherLookup.get(subject.added_by_teacher_id)}`
            : "Pending review"}
        </span>
      )}
      <span className="inline-block rounded-pill bg-lime-100 text-lime-600 px-2 py-0.5 text-xs font-semibold flex-shrink-0">
        Active
      </span>
      <RowMenu
        actions={[
          { label: "Edit", onClick: () => setEditing(true) },
          { label: "Deactivate", onClick: onDeactivate, danger: true },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubjectListEditor — the add-subject form + subject rows, shared between a
// group's subject list and a curriculum's direct subject list (for curricula
// with no groups, e.g. ACT/SAT/TOEFL/IELTS).
// ---------------------------------------------------------------------------

function SubjectListEditor({
  activeSubjects, inactiveSubjects, showAddForm, updateSubject, teacherLookup,
  newSubject, setNewSubject, addingSubject, addSubjectError, onSubmitAdd, onCancelAdd,
}: {
  activeSubjects: Subject[];
  inactiveSubjects: Subject[];
  showAddForm: boolean;
  updateSubject: (id: number, input: Partial<Subject>) => Promise<{ data: Subject | null; error: string | null }>;
  teacherLookup?: Map<string, string>;
  newSubject: { name: string; board: string; code: string; level: string };
  setNewSubject: React.Dispatch<React.SetStateAction<{ name: string; board: string; code: string; level: string }>>;
  addingSubject: boolean;
  addSubjectError: string | null;
  onSubmitAdd: () => void;
  onCancelAdd: () => void;
}) {
  return (
    <>
      {showAddForm && (
        <Card className="p-4 mb-3 border border-sky-100">
          <p className="text-xs font-semibold text-navy-500 mb-3">New subject</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-xs font-medium text-navy-500 mb-1 block">Name *</label>
              <input
                value={newSubject.name}
                onChange={(e) => setNewSubject((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Biology"
                autoFocus
                className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-navy-500 mb-1 block">Level (optional)</label>
              <input
                value={newSubject.level}
                onChange={(e) => setNewSubject((f) => ({ ...f, level: e.target.value }))}
                placeholder="e.g. Standard Level, Higher Level"
                className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-navy-500 mb-1 block">Board (optional)</label>
              <input
                value={newSubject.board}
                onChange={(e) => setNewSubject((f) => ({ ...f, board: e.target.value }))}
                placeholder="e.g. Cambridge, Pearson Edexcel"
                className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-navy-500 mb-1 block">Subject code (optional)</label>
              <input
                value={newSubject.code}
                onChange={(e) => setNewSubject((f) => ({ ...f, code: e.target.value }))}
                placeholder="e.g. 9700, 0610"
                className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
          </div>
          {addSubjectError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{addSubjectError}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={onSubmitAdd} disabled={addingSubject || !newSubject.name.trim()}>
              {addingSubject ? "Adding…" : "Add Subject"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelAdd}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="space-y-1.5">
        {groupSubjectsByBase(activeSubjects).map((base) => {
          // Single item with no level — render as a plain row, no nesting needed.
          if (base.items.length === 1 && !base.items[0].level) {
            const s = base.items[0];
            return (
              <SubjectEditRow
                key={s.id}
                subject={s}
                onSave={updateSubject}
                onDeactivate={() => updateSubject(s.id, { is_active: false })}
                teacherLookup={teacherLookup}
              />
            );
          }
          // Subject with one or more levels (e.g. HL/SL) — nest level rows under the subject name.
          return (
            <div key={base.key} className="rounded-xl border border-navy-50 bg-navy-50/30 pl-3 py-2">
              <p className="text-xs font-semibold text-navy-500 mb-1.5">{base.baseLabel}</p>
              <div className="space-y-1">
                {base.items.map((s) => (
                  <SubjectEditRow
                    key={s.id}
                    subject={s}
                    displayLabel={s.level || "—"}
                    onSave={updateSubject}
                    onDeactivate={() => updateSubject(s.id, { is_active: false })}
                    teacherLookup={teacherLookup}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {activeSubjects.length === 0 && !showAddForm && (
          <p className="text-navy-300 text-sm">No subjects yet. Click + Add Subject above.</p>
        )}
      </div>

      {inactiveSubjects.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-navy-400 cursor-pointer select-none hover:text-navy-600">
            {inactiveSubjects.length} inactive subject{inactiveSubjects.length !== 1 ? "s" : ""}
          </summary>
          <div className="space-y-1 mt-2">
            {inactiveSubjects.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white border-navy-100 opacity-60">
                <span className="text-sm text-navy-500 flex-1 min-w-0 truncate">
                  {subjectBaseLabel(s.name, s.board, s.subject_code)}{s.level ? ` — ${s.level}` : ""}
                </span>
                <span className="text-xs text-navy-400">Inactive</span>
                <button
                  type="button"
                  onClick={() => updateSubject(s.id, { is_active: true })}
                  className="text-xs text-sky-500 hover:text-sky-600 flex-shrink-0"
                >
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// AcademicsTab — accordion tree: Curriculum → Group → Subject, or for
// curricula with no groups (e.g. ACT/SAT/TOEFL/IELTS), Curriculum → Subject
// directly.
// ---------------------------------------------------------------------------

function AcademicsTab({
  curricula, createCurriculum, updateCurriculum,
  allGroups, createGroup, updateGroup, deactivateGroup,
  subjects, createSubject, updateSubject,
  categories,
  teacherLookup,
}: {
  curricula: Curriculum[];
  createCurriculum: (name: string) => Promise<{ data: Curriculum | null; error: string | null }>;
  updateCurriculum: (id: number, input: Partial<Curriculum>) => Promise<{ data: Curriculum | null; error: string | null }>;
  allGroups: CurriculumGroup[];
  createGroup: (curriculumId: number, name: string) => Promise<{ data: CurriculumGroup | null; error: string | null }>;
  updateGroup: (id: number, input: Partial<CurriculumGroup>) => Promise<{ data: CurriculumGroup | null; error: string | null }>;
  deactivateGroup: (id: number) => Promise<{ error: string | null }>;
  subjects: Subject[];
  createSubject: (input: { name: string; category: string; category_id?: number; curriculum_group_id?: number; curriculum_id?: number; board?: string; subject_code?: string; level?: string }) => Promise<{ data: Subject | null; error: string | null }>;
  updateSubject: (id: number, input: Partial<Subject>) => Promise<{ data: Subject | null; error: string | null }>;
  categories: SubjectCategory[];
  teacherLookup?: Map<string, string>;
}) {
  const [expandedCurricula, setExpandedCurricula] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // Add curriculum
  const [showAddCurriculum, setShowAddCurriculum] = useState(false);
  const [newCurriculumName, setNewCurriculumName] = useState("");
  const [addingCurriculum, setAddingCurriculum] = useState(false);
  const [addCurriculumError, setAddCurriculumError] = useState<string | null>(null);

  // Add group (per curriculum)
  const [addGroupFor, setAddGroupFor] = useState<number | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [addGroupError, setAddGroupError] = useState<string | null>(null);

  // Rename curriculum
  const [renamingCurriculumId, setRenamingCurriculumId] = useState<number | null>(null);
  const [renameCurriculumVal, setRenameCurriculumVal] = useState("");

  // Deactivate curriculum confirm
  const [confirmDeactivateCurriculumId, setConfirmDeactivateCurriculumId] = useState<number | null>(null);

  // Rename group
  const [renamingGroupId, setRenamingGroupId] = useState<number | null>(null);
  const [renameGroupVal, setRenameGroupVal] = useState("");

  // Deactivate group confirm
  const [confirmDeactivateGroupId, setConfirmDeactivateGroupId] = useState<number | null>(null);

  // Add subject — either under a group, or directly under a curriculum with no groups
  const [addSubjectFor, setAddSubjectFor] = useState<AddSubjectTarget | null>(null);
  const [newSubject, setNewSubject] = useState({ name: "", board: "", code: "", level: "" });
  const [addingSubject, setAddingSubject] = useState(false);
  const [addSubjectError, setAddSubjectError] = useState<string | null>(null);

  const academicCategoryId = categories.find((c) => c.type === "academic" && c.is_active)?.id;
  const activeCurricula = curricula.filter((c) => c.is_active);

  function toggleCurriculum(id: number) {
    setExpandedCurricula((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleGroup(id: number) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAddCurriculum() {
    if (!newCurriculumName.trim()) return;
    setAddingCurriculum(true);
    setAddCurriculumError(null);
    const { error } = await createCurriculum(newCurriculumName.trim());
    setAddingCurriculum(false);
    if (error) { setAddCurriculumError(error); }
    else { setNewCurriculumName(""); setShowAddCurriculum(false); }
  }

  async function handleAddGroup(curriculumId: number) {
    if (!newGroupName.trim()) return;
    setAddingGroup(true);
    setAddGroupError(null);
    const { data, error } = await createGroup(curriculumId, newGroupName.trim());
    setAddingGroup(false);
    if (error) { setAddGroupError(error); }
    else {
      setNewGroupName("");
      setAddGroupFor(null);
      if (data) {
        setExpandedCurricula((prev) => new Set([...prev, curriculumId]));
        setExpandedGroups((prev) => new Set([...prev, data.id]));
      }
    }
  }

  async function handleRenameCurriculum(curriculumId: number) {
    if (!renameCurriculumVal.trim()) return;
    await updateCurriculum(curriculumId, { name: renameCurriculumVal.trim() });
    setRenamingCurriculumId(null);
  }

  async function handleDeactivateCurriculum(curriculumId: number) {
    await updateCurriculum(curriculumId, { is_active: false });
    setConfirmDeactivateCurriculumId(null);
    setExpandedCurricula((prev) => { const n = new Set(prev); n.delete(curriculumId); return n; });
  }

  async function handleRenameGroup(groupId: number) {
    if (!renameGroupVal.trim()) return;
    await updateGroup(groupId, { name: renameGroupVal.trim() });
    setRenamingGroupId(null);
  }

  async function handleDeactivateGroup(groupId: number) {
    await deactivateGroup(groupId);
    setConfirmDeactivateGroupId(null);
    setExpandedGroups((prev) => { const n = new Set(prev); n.delete(groupId); return n; });
    if (addSubjectFor?.kind === "group" && addSubjectFor.id === groupId) setAddSubjectFor(null);
  }

  async function handleAddSubject(target: AddSubjectTarget) {
    if (!newSubject.name.trim()) return;
    setAddingSubject(true);
    setAddSubjectError(null);
    const { error } = await createSubject({
      name: newSubject.name.trim(),
      category: "academic",
      ...(academicCategoryId != null ? { category_id: academicCategoryId } : {}),
      ...(target.kind === "group" ? { curriculum_group_id: target.id } : { curriculum_id: target.id }),
      ...(newSubject.board.trim() ? { board: newSubject.board.trim() } : {}),
      ...(newSubject.code.trim() ? { subject_code: newSubject.code.trim() } : {}),
      ...(newSubject.level.trim() ? { level: newSubject.level.trim() } : {}),
    });
    setAddingSubject(false);
    if (error) { setAddSubjectError(error); }
    else { setNewSubject({ name: "", board: "", code: "", level: "" }); setAddSubjectFor(null); }
  }

  function openAddSubject(target: AddSubjectTarget) {
    setAddSubjectFor(target);
    setNewSubject({ name: "", board: "", code: "", level: "" });
    setAddSubjectError(null);
  }

  const confirmGroupObj = confirmDeactivateGroupId !== null
    ? allGroups.find((g) => g.id === confirmDeactivateGroupId)
    : null;

  const confirmCurriculumObj = confirmDeactivateCurriculumId !== null
    ? curricula.find((c) => c.id === confirmDeactivateCurriculumId)
    : null;

  return (
    <div className="max-w-2xl">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-300">Curricula</p>
        <Button
          size="sm"
          className="flex items-center gap-1"
          onClick={() => { setShowAddCurriculum((v) => !v); setNewCurriculumName(""); setAddCurriculumError(null); }}
        >
          <IconPlus /> Add Curriculum
        </Button>
      </div>

      {showAddCurriculum && (
        <Card className="p-3 mb-4 border border-sky-100">
          <div className="flex items-center gap-2">
            <input
              value={newCurriculumName}
              onChange={(e) => { setNewCurriculumName(e.target.value); setAddCurriculumError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddCurriculum(); if (e.key === "Escape") setShowAddCurriculum(false); }}
              placeholder="Curriculum name…"
              autoFocus
              className="flex-1 rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <Button size="sm" onClick={handleAddCurriculum} disabled={addingCurriculum || !newCurriculumName.trim()}>
              {addingCurriculum ? "Adding…" : "Add"}
            </Button>
            <button type="button" onClick={() => setShowAddCurriculum(false)} className="text-xs text-navy-400 hover:text-navy-600">Cancel</button>
          </div>
          {addCurriculumError && <p className="text-xs text-red-600 mt-1">{addCurriculumError}</p>}
        </Card>
      )}

      {activeCurricula.length === 0 && !showAddCurriculum && (
        <p className="text-navy-300 text-sm">No curricula yet. Click + Add Curriculum above.</p>
      )}

      {/* Curriculum tree */}
      <div className="space-y-2">
        {activeCurricula.map((curriculum) => {
          const isExpanded = expandedCurricula.has(curriculum.id);
          const curriculumGroups = allGroups.filter((g) => g.curriculum_id === curriculum.id && g.is_active);
          // Curricula with no groups (e.g. ACT/SAT/TOEFL/IELTS — a single
          // standardized exam, not worth breaking into groups) keep their
          // subjects directly, keyed by subjects.curriculum_id instead of
          // going through a group.
          const isUngrouped = curriculumGroups.length === 0;
          const directSubjects = isUngrouped ? subjects.filter((s) => s.curriculum_id === curriculum.id) : [];
          const activeDirectSubjects = directSubjects.filter((s) => s.is_active);
          const inactiveDirectSubjects = directSubjects.filter((s) => !s.is_active);
          const addingDirectSubject = addSubjectFor?.kind === "curriculum" && addSubjectFor.id === curriculum.id;

          return (
            <div key={curriculum.id} className="rounded-xl border border-navy-100 bg-white overflow-hidden">
              {/* Curriculum row */}
              <div className="flex items-center gap-2 px-4 py-3">
                {renamingCurriculumId !== curriculum.id && (
                  <button
                    type="button"
                    onClick={() => toggleCurriculum(curriculum.id)}
                    className="text-navy-300 hover:text-navy-600 text-xs w-4 flex-shrink-0 leading-none"
                  >
                    {isExpanded ? "▼" : "▶"}
                  </button>
                )}
                {renamingCurriculumId === curriculum.id ? (
                  <>
                    <input
                      value={renameCurriculumVal}
                      onChange={(e) => setRenameCurriculumVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameCurriculum(curriculum.id);
                        if (e.key === "Escape") setRenamingCurriculumId(null);
                      }}
                      autoFocus
                      className="flex-1 rounded-lg border border-navy-100 px-2 py-1 text-sm font-semibold text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                    />
                    <Button size="xs" onClick={() => handleRenameCurriculum(curriculum.id)}>Save</Button>
                    <button type="button" onClick={() => setRenamingCurriculumId(null)} className="text-xs text-navy-400 hover:text-navy-600">Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-navy-700 flex-1">{curriculum.name}</span>
                    <span className="text-xs text-navy-400 flex-shrink-0">
                      {isUngrouped
                        ? `${activeDirectSubjects.length} subject${activeDirectSubjects.length !== 1 ? "s" : ""}`
                        : `${curriculumGroups.length} group${curriculumGroups.length !== 1 ? "s" : ""}`}
                    </span>
                    <RowMenu
                      actions={[
                        // Ungrouped curricula (ACT/SAT/TOEFL/IELTS) are meant to
                        // stay standalone — no "Add Group" for them.
                        ...(isUngrouped
                          ? [{
                              label: "Add Subject",
                              onClick: () => { openAddSubject({ kind: "curriculum", id: curriculum.id }); setExpandedCurricula((prev) => new Set([...prev, curriculum.id])); },
                            }]
                          : [{
                              label: "Add Group",
                              onClick: () => {
                                setAddGroupFor(curriculum.id);
                                setNewGroupName("");
                                setAddGroupError(null);
                                setExpandedCurricula((prev) => new Set([...prev, curriculum.id]));
                              },
                            }]),
                        {
                          label: "Rename",
                          onClick: () => { setRenamingCurriculumId(curriculum.id); setRenameCurriculumVal(curriculum.name); },
                        },
                        {
                          label: "Deactivate",
                          onClick: () => setConfirmDeactivateCurriculumId(curriculum.id),
                          danger: true,
                        },
                      ]}
                    />
                  </>
                )}
              </div>

              {/* Expanded curriculum body */}
              {isExpanded && (
                <div className="border-t border-navy-50 px-4 py-3 bg-navy-50/30">
                  {isUngrouped ? (
                    // No groups — subjects sit directly under the curriculum
                    // (e.g. ACT/SAT/TOEFL/IELTS).
                    <SubjectListEditor
                      activeSubjects={activeDirectSubjects}
                      inactiveSubjects={inactiveDirectSubjects}
                      showAddForm={addingDirectSubject}
                      updateSubject={updateSubject}
                      teacherLookup={teacherLookup}
                      newSubject={newSubject}
                      setNewSubject={setNewSubject}
                      addingSubject={addingSubject}
                      addSubjectError={addSubjectError}
                      onSubmitAdd={() => handleAddSubject({ kind: "curriculum", id: curriculum.id })}
                      onCancelAdd={() => setAddSubjectFor(null)}
                    />
                  ) : (
                    <div className="space-y-1.5">
                      {curriculumGroups.map((group) => {
                        const isGroupExpanded = expandedGroups.has(group.id);
                        const groupSubjects = subjects.filter((s) => s.curriculum_group_id === group.id);
                        const activeGroupSubjects = groupSubjects.filter((s) => s.is_active);
                        const inactiveGroupSubjects = groupSubjects.filter((s) => !s.is_active);
                        const isRenaming = renamingGroupId === group.id;
                        const addingGroupSubject = addSubjectFor?.kind === "group" && addSubjectFor.id === group.id;

                        return (
                          <div key={group.id} className="rounded-lg border border-navy-100 bg-white overflow-hidden">
                            {/* Group row */}
                            <div className="flex items-center gap-2 px-3 py-2.5">
                              {!isRenaming && (
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.id)}
                                  className="text-navy-300 hover:text-navy-600 text-xs w-4 flex-shrink-0 leading-none"
                                >
                                  {isGroupExpanded ? "▼" : "▶"}
                                </button>
                              )}
                              {isRenaming ? (
                                <>
                                  <input
                                    value={renameGroupVal}
                                    onChange={(e) => setRenameGroupVal(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleRenameGroup(group.id);
                                      if (e.key === "Escape") setRenamingGroupId(null);
                                    }}
                                    autoFocus
                                    className="flex-1 rounded-lg border border-navy-100 px-2 py-1 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                                  />
                                  <Button size="xs" onClick={() => handleRenameGroup(group.id)}>Save</Button>
                                  <button type="button" onClick={() => setRenamingGroupId(null)} className="text-xs text-navy-400 hover:text-navy-600">Cancel</button>
                                </>
                              ) : (
                                <>
                                  <span className="text-sm font-medium text-navy-700 flex-1">{group.name}</span>
                                  <span className="text-xs text-navy-400 flex-shrink-0">
                                    {activeGroupSubjects.length} subject{activeGroupSubjects.length !== 1 ? "s" : ""}
                                  </span>
                                  <RowMenu
                                    actions={[
                                      { label: "Add Subject", onClick: () => { openAddSubject({ kind: "group", id: group.id }); setExpandedGroups((prev) => new Set([...prev, group.id])); } },
                                      { label: "Rename", onClick: () => { setRenamingGroupId(group.id); setRenameGroupVal(group.name); } },
                                      { label: "Deactivate", onClick: () => setConfirmDeactivateGroupId(group.id), danger: true },
                                    ]}
                                  />
                                </>
                              )}
                            </div>

                            {/* Expanded group body */}
                            {isGroupExpanded && !isRenaming && (
                              <div className="border-t border-navy-50 px-3 py-2.5 bg-navy-50/20">
                                <SubjectListEditor
                                  activeSubjects={activeGroupSubjects}
                                  inactiveSubjects={inactiveGroupSubjects}
                                  showAddForm={addingGroupSubject}
                                  updateSubject={updateSubject}
                                  teacherLookup={teacherLookup}
                                  newSubject={newSubject}
                                  setNewSubject={setNewSubject}
                                  addingSubject={addingSubject}
                                  addSubjectError={addSubjectError}
                                  onSubmitAdd={() => handleAddSubject({ kind: "group", id: group.id })}
                                  onCancelAdd={() => setAddSubjectFor(null)}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add Group form */}
                  {addGroupFor === curriculum.id && (
                    <Card className="p-3 mt-3 border border-sky-100">
                      <div className="flex items-center gap-2">
                        <input
                          value={newGroupName}
                          onChange={(e) => { setNewGroupName(e.target.value); setAddGroupError(null); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddGroup(curriculum.id);
                            if (e.key === "Escape") setAddGroupFor(null);
                          }}
                          placeholder="Group name…"
                          autoFocus
                          className="flex-1 rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        />
                        <Button size="sm" onClick={() => handleAddGroup(curriculum.id)} disabled={addingGroup || !newGroupName.trim()}>
                          {addingGroup ? "Adding…" : "Add"}
                        </Button>
                        <button type="button" onClick={() => setAddGroupFor(null)} className="text-xs text-navy-400 hover:text-navy-600">Cancel</button>
                      </div>
                      {addGroupError && <p className="text-xs text-red-600 mt-1">{addGroupError}</p>}
                    </Card>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmDeactivateGroupId !== null}
        title={`Deactivate "${confirmGroupObj?.name}"?`}
        description="This hides the group and its subjects from all selection flows. Subjects are kept but won't appear in the app. Historical session data is not affected."
        confirmLabel="Deactivate group"
        onConfirm={() => { if (confirmDeactivateGroupId !== null) handleDeactivateGroup(confirmDeactivateGroupId); }}
        onCancel={() => setConfirmDeactivateGroupId(null)}
        isDangerous
      />

      <ConfirmDialog
        open={confirmDeactivateCurriculumId !== null}
        title={`Deactivate "${confirmCurriculumObj?.name}"?`}
        description="This hides the curriculum and all its groups/subjects from all selection flows. All data is preserved and can be reactivated from the Inactive tab."
        confirmLabel="Deactivate curriculum"
        onConfirm={() => { if (confirmDeactivateCurriculumId !== null) handleDeactivateCurriculum(confirmDeactivateCurriculumId); }}
        onCancel={() => setConfirmDeactivateCurriculumId(null)}
        isDangerous
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FlatSubjectsTab — shared by BeyondAcademicsTab and CollegeCounsellingTab
// ---------------------------------------------------------------------------

// No sections/categories at all: every subject shown here is flat and equal
// — a subject is never grouped under another subject. Which subjects show
// (and what category a newly-added one gets) is parameterized so Beyond
// Academics and College Counselling can share this exact same UI/logic
// without duplicating it — see db/docs/SUBJECT_HIERARCHY.md.
function FlatSubjectsTab({
  subjects, updateSubject, createSubject, teacherLookup, matchesCategory, newSubjectCategory, addPlaceholder,
}: {
  subjects: Subject[];
  createSubject: (input: { name: string; category: string; category_id?: number }) => Promise<{ data: Subject | null; error: string | null }>;
  updateSubject: (id: number, input: Partial<Subject>) => Promise<{ data: Subject | null; error: string | null }>;
  teacherLookup?: Map<string, string>;
  matchesCategory: (category: string) => boolean;
  newSubjectCategory: string;
  addPlaceholder: string;
}) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("normal");
  const [editValues, setEditValues] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const q = search.toLowerCase();
  const beyondSubjects = subjects.filter(
    (s) => matchesCategory(s.category) && s.is_active && s.name.toLowerCase().includes(q)
  );

  function enterMode(m: Mode) {
    setMode(m); setSelected(new Set()); setActionError(null);
    setEditValues(m === "edit" ? new Map(beyondSubjects.map((s) => [s.id, s.name])) : new Map());
  }

  function exitMode() {
    setMode("normal"); setSelected(new Set()); setEditValues(new Map()); setActionError(null);
  }

  async function handleAddSubject() {
    if (!newName.trim()) return;
    setAddSaving(true); setAddError(null);
    const { error } = await createSubject({ name: newName.trim(), category: newSubjectCategory });
    setAddSaving(false);
    if (error) { setAddError(error); } else { setNewName(""); setShowAdd(false); }
  }

  async function saveEdits() {
    setSaving(true);
    for (const s of beyondSubjects) {
      const val = editValues.get(s.id)?.trim();
      if (val && val !== s.name) await updateSubject(s.id, { name: val });
    }
    setSaving(false); exitMode();
  }

  async function applyDeactivate() {
    setSaving(true);
    for (const id of selected) {
      await updateSubject(id, { is_active: false });
    }
    setSaving(false); exitMode();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="max-w-sm flex-1">
          <TextInput label="Search subjects" placeholder="Filter by name…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {mode === "normal" ? (
            <>
              <Button size="sm" className="flex items-center gap-1"
                onClick={() => { setShowAdd((v) => !v); setAddError(null); setNewName(""); }}>
                <IconPlus /> Add
              </Button>
              <RowMenu
                actions={[
                  { label: "Edit subjects", onClick: () => enterMode("edit") },
                  { label: "Deactivate subjects", onClick: () => enterMode("deactivate") },
                ]}
              />
            </>
          ) : (
            <>
              {mode !== "edit" && <span className="text-xs text-navy-400 font-medium">{selected.size} selected</span>}
              {mode === "edit" && (
                <Button size="sm" onClick={saveEdits} disabled={saving}>{saving ? "Saving…" : "Save all"}</Button>
              )}
              {mode === "deactivate" && (
                <Button size="sm" onClick={applyDeactivate} disabled={selected.size === 0 || saving}>
                  {saving ? "Saving…" : selected.size === 0 ? "Deactivate selected" : `Deactivate ${selected.size} selected`}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={exitMode}>Cancel</Button>
            </>
          )}
        </div>
      </div>

      {actionError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{actionError}</p>}

      {showAdd && mode === "normal" && (
        <Card className="p-4 mb-4 max-w-md border border-sky-100">
          <div className="flex flex-col gap-3">
            <TextInput label="Subject name" placeholder={addPlaceholder} value={newName}
              onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddSubject(); if (e.key === "Escape") setShowAdd(false); }}
              autoFocus />
            {addError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{addError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddSubject} disabled={addSaving || !newName.trim()}>{addSaving ? "Adding…" : "Add"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      {mode === "deactivate" && beyondSubjects.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 mb-1 text-xs text-navy-400">
          <input type="checkbox"
            checked={selected.size === beyondSubjects.length && beyondSubjects.length > 0}
            onChange={() => setSelected(selected.size === beyondSubjects.length ? new Set() : new Set(beyondSubjects.map((s) => s.id)))}
            className="rounded border-navy-200 accent-sky-500" />
          <span>Select all</span>
        </div>
      )}

      <div className="space-y-1">
        {beyondSubjects.map((s) => (
          <div key={s.id} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white transition-colors ${mode === "deactivate" && selected.has(s.id) ? "border-sky-200 bg-sky-50" : "border-navy-100"}`}>
            {mode === "deactivate" && (
              <input type="checkbox" checked={selected.has(s.id)}
                onChange={() => { setSelected((prev) => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; }); }}
                className="rounded border-navy-200 accent-sky-500 flex-shrink-0" />
            )}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {mode === "edit" ? (
                <input value={editValues.get(s.id) ?? s.name}
                  onChange={(e) => setEditValues((m) => new Map([...m, [s.id, e.target.value]]))}
                  className="rounded-lg border border-navy-100 px-2 py-1 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-sky-300" />
              ) : (
                <span className="text-sm text-navy-700">{s.name}</span>
              )}
              {s.added_by_teacher_id != null && !s.acknowledged_at && (
                <span className="inline-flex items-center gap-1 rounded-pill bg-red-50 text-red-500 border border-red-200 px-2 py-0.5 text-xs font-semibold"
                  title={`Added by ${teacherLookup?.get(s.added_by_teacher_id) ?? "teacher"} — pending PC review`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  {teacherLookup?.get(s.added_by_teacher_id)
                    ? `Added by ${teacherLookup.get(s.added_by_teacher_id)}`
                    : "Pending review"}
                </span>
              )}
            </div>
          </div>
        ))}
        {beyondSubjects.length === 0 && <p className="text-navy-300 text-sm">No subjects yet. Add one above.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InactiveTab
// ---------------------------------------------------------------------------

function InactiveTab({
  curricula, updateCurriculum,
  allGroups, reactivateGroup,
  subjects, categories, updateSubject, updateCategory,
}: {
  curricula: Curriculum[];
  updateCurriculum: (id: number, input: Partial<Curriculum>) => Promise<{ data: Curriculum | null; error: string | null }>;
  allGroups: CurriculumGroup[];
  reactivateGroup: (id: number) => Promise<{ error: string | null }>;
  subjects: Subject[];
  categories: SubjectCategory[];
  updateSubject: (id: number, input: Partial<Subject>) => Promise<{ data: Subject | null; error: string | null }>;
  updateCategory: (id: number, input: Partial<SubjectCategory>) => Promise<{ data: SubjectCategory | null; error: string | null }>;
}) {
  const inactiveCurricula = curricula.filter((c) => !c.is_active);
  const inactiveGroups = allGroups.filter((g) => !g.is_active);
  const inactiveCats = categories.filter((c) => !c.is_active);
  const sectionsWithInactive = categories
    .filter((c) => c.is_active)
    .map((cat) => ({ cat, subs: subjects.filter((s) => s.category_id === cat.id && !s.is_active) }))
    .filter((x) => x.subs.length > 0);

  const nothing = inactiveCurricula.length === 0 && inactiveGroups.length === 0 && inactiveCats.length === 0 && sectionsWithInactive.length === 0;

  if (nothing) {
    return <p className="text-navy-300 text-sm mt-2">Nothing inactive yet.</p>;
  }

  return (
    <div className="space-y-8">
      {inactiveCurricula.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">Inactive Curricula</h2>
          <div className="space-y-1">
            {inactiveCurricula.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-navy-100 bg-white">
                <span className="text-sm font-medium text-navy-500">{c.name}</span>
                <button type="button" onClick={() => updateCurriculum(c.id, { is_active: true })}
                  className="text-xs text-sky-500 hover:text-sky-600 font-medium px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors">
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {inactiveGroups.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">Inactive Subject Groups</h2>
          <div className="space-y-1">
            {inactiveGroups.map((g) => (
              <div key={g.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-navy-100 bg-white">
                <div>
                  <span className="text-sm font-medium text-navy-500">{g.name}</span>
                  <span className="text-xs text-navy-300 ml-2">
                    ({curricula.find((c) => c.id === g.curriculum_id)?.name ?? `Curriculum #${g.curriculum_id}`})
                  </span>
                </div>
                <button type="button" onClick={() => reactivateGroup(g.id)}
                  className="text-xs text-sky-500 hover:text-sky-600 font-medium px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors">
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {inactiveCats.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">Inactive Sections (Beyond Academics)</h2>
          {inactiveCats.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-navy-100 bg-white mb-1">
              <span className="text-sm font-medium text-navy-500">{cat.name}</span>
              <button type="button" onClick={() => updateCategory(cat.id, { is_active: true })}
                className="text-xs text-sky-500 hover:text-sky-600 font-medium px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors">
                Reactivate
              </button>
            </div>
          ))}
        </div>
      )}

      {sectionsWithInactive.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">Inactive Subjects (Beyond Academics)</h2>
          {sectionsWithInactive.map(({ cat, subs }) => (
            <div key={cat.id} className="mb-4">
              <p className="text-sm font-semibold text-navy-600 mb-2">{cat.name}</p>
              <div className="space-y-1">
                {subs.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-navy-100 bg-white">
                    <span className="text-sm text-navy-500">{s.name}</span>
                    <button type="button" onClick={() => updateSubject(s.id, { is_active: true })}
                      className="text-xs text-sky-500 hover:text-sky-600 font-medium px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors">
                      Reactivate
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubjectsLibraryContent — used by AdminSubjectsManagePage (admin only, at
// `/admin/subjects`). Performance coaches had their own equivalent page
// (`/teacher/subjects-library`, `CoachSubjectsManagePage`) until 2026-07-28,
// when PC access to catalog management was removed; `TeacherSubjectEditor`'s
// self-service "My Subjects" (`/teacher/subjects`) is unaffected — it only
// assigns already-existing subjects, it doesn't create new ones.
// ---------------------------------------------------------------------------

export function SubjectsLibraryContent() {
  const [tab, setTab] = useState<Tab>("academics");
  const { curricula, loading: curriculaLoading, createCurriculum, updateCurriculum } = useAllCurricula();
  const { subjects, loading: subjectsLoading, createSubject, updateSubject } = useAllSubjects();
  const { categories, loading: catsLoading, updateCategory } = useAllSubjectCategories();
  const { groups: allGroups, loading: groupsLoading, createGroup, updateGroup, deactivateGroup, reactivateGroup } = useAllCurriculumGroups();

  const pendingTeacherIds = [
    ...new Set([
      ...subjects.filter((s) => s.added_by_teacher_id != null && !s.acknowledged_at).map((s) => s.added_by_teacher_id as string),
      ...curricula.filter((c) => c.added_by_teacher_id != null && !c.acknowledged_at).map((c) => c.added_by_teacher_id as string),
    ]),
  ];
  const teacherLookup = useTeacherNames(pendingTeacherIds);

  const dataLoading = curriculaLoading || subjectsLoading || catsLoading || groupsLoading;

  const inactiveCount =
    curricula.filter((c) => !c.is_active).length +
    allGroups.filter((g) => !g.is_active).length +
    categories.filter((c) => !c.is_active).length +
    subjects.filter((s) => !s.is_active && s.category !== "academic").length;

  const tabLabel: Record<Tab, string> = {
    academics: "Academics",
    beyond_academics: "Beyond Academics",
    college_counselling: "College Counselling",
    inactive: "Inactive",
  };

  return (
    <>
      <div className="flex gap-1 mb-6 border-b border-navy-100">
        {(["academics", "beyond_academics", "college_counselling", "inactive"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? "border-sky-400 text-sky-500" : "border-transparent text-navy-400 hover:text-navy-600"
            }`}>
            {t === "inactive" ? (
              <span className="flex items-center gap-1.5">
                {tabLabel[t]}
                {inactiveCount > 0 && (
                  <span className="inline-block bg-navy-100 text-navy-400 rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none">
                    {inactiveCount}
                  </span>
                )}
              </span>
            ) : tabLabel[t]}
          </button>
        ))}
      </div>

      {dataLoading && (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      )}

      {!dataLoading && tab === "academics" && (
        <AcademicsTab
          curricula={curricula}
          createCurriculum={createCurriculum}
          updateCurriculum={updateCurriculum}
          allGroups={allGroups}
          createGroup={createGroup}
          updateGroup={updateGroup}
          deactivateGroup={deactivateGroup}
          subjects={subjects}
          createSubject={createSubject}
          updateSubject={updateSubject}
          categories={categories}
          teacherLookup={teacherLookup}
        />
      )}

      {!dataLoading && tab === "beyond_academics" && (
        <FlatSubjectsTab subjects={subjects}
          createSubject={createSubject} updateSubject={updateSubject}
          teacherLookup={teacherLookup}
          matchesCategory={(c) => c !== "academic" && c !== "college_counselling"}
          newSubjectCategory="beyond_academic"
          addPlaceholder="e.g. Book Publishing" />
      )}

      {!dataLoading && tab === "college_counselling" && (
        <FlatSubjectsTab subjects={subjects}
          createSubject={createSubject} updateSubject={updateSubject}
          teacherLookup={teacherLookup}
          matchesCategory={(c) => c === "college_counselling"}
          newSubjectCategory="college_counselling"
          addPlaceholder="e.g. College Essays" />
      )}

      {!dataLoading && tab === "inactive" && (
        <InactiveTab
          curricula={curricula}
          updateCurriculum={updateCurriculum}
          allGroups={allGroups}
          reactivateGroup={reactivateGroup}
          subjects={subjects}
          categories={categories}
          updateSubject={updateSubject}
          updateCategory={updateCategory}
        />
      )}
    </>
  );
}

import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/Input";
import { IconPlus } from "../../components/ui/icons";
import { Spinner } from "../../components/ui/Spinner";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import type { ProgramType } from "../../types/database";

type Tab = "types" | "inactive";
type Mode = "normal" | "edit" | "deactivate";

// ---------------------------------------------------------------------------
// StandaloneSection — flat list for top-level types with no children
// ---------------------------------------------------------------------------

function StandaloneSection({
  types,
  createProgramType,
  updateProgramType,
}: {
  types: ProgramType[];
  createProgramType: (name: string, parentId?: number | null) => Promise<{ data: ProgramType | null; error: string | null }>;
  updateProgramType: (id: number, input: Partial<ProgramType>) => Promise<{ data: ProgramType | null; error: string | null }>;
}) {
  const [open, setOpen] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("normal");
  const [editValues, setEditValues] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAddSaving(true); setAddError(null);
    const { error } = await createProgramType(newName.trim(), null);
    setAddSaving(false);
    if (error) { setAddError(error); } else { setNewName(""); setShowAdd(false); }
  }

  function enterMode(m: Mode) {
    setMode(m); setSelected(new Set()); setEditError(null);
    setEditValues(m === "edit" ? new Map(types.map((t) => [t.id, t.name])) : new Map());
  }

  function exitMode() {
    setMode("normal"); setSelected(new Set()); setEditValues(new Map()); setEditError(null);
  }

  async function saveEdits() {
    setSaving(true); setEditError(null);
    for (const t of types) {
      const val = editValues.get(t.id)?.trim();
      if (val && val !== t.name) {
        const { error } = await updateProgramType(t.id, { name: val });
        if (error) { setEditError(`Couldn't rename "${t.name}": ${error}`); setSaving(false); return; }
      }
    }
    setSaving(false); exitMode();
  }

  async function applyDeactivate() {
    setSaving(true);
    for (const id of selected) {
      const t = types.find((x) => x.id === id);
      if (t) await updateProgramType(id, { is_active: !t.is_active });
    }
    setSaving(false); exitMode();
  }

  function deactivateLabel() {
    const sel = types.filter((t) => selected.has(t.id));
    if (sel.length === 0) return "Deactivate selected";
    if (sel.every((t) => t.is_active)) return `Deactivate ${sel.length} selected`;
    if (sel.every((t) => !t.is_active)) return `Activate ${sel.length} selected`;
    return `Update ${sel.length} selected`;
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={() => { if (open) setShowAdd(false); setOpen((v) => !v); }}
          className="flex items-center gap-2 text-left">
          <span className="text-navy-300 hover:text-navy-600 text-xs w-4 flex-shrink-0 leading-none">
            {open ? "▼" : "▶"}
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400">Standalone Types</h2>
        </button>
        <div className="flex items-center gap-2">
          {mode === "normal" ? (
            <>
              <Button size="sm" className="flex items-center gap-1"
                onClick={() => { setShowAdd((v) => !v); setAddError(null); setNewName(""); if (!open) setOpen(true); }}>
                <IconPlus /> Add
              </Button>
              <Button size="xs" variant="ghost" onClick={() => { enterMode("edit"); setOpen(true); }}>Edit</Button>
              <Button size="xs" variant="ghost" onClick={() => { enterMode("deactivate"); setOpen(true); }}>Deactivate</Button>
            </>
          ) : (
            <>
              {mode !== "edit" && <span className="text-xs text-navy-400 font-medium">{selected.size} selected</span>}
              {mode === "edit" && (
                <Button size="sm" onClick={saveEdits} disabled={saving}>{saving ? "Saving…" : "Save all"}</Button>
              )}
              {mode === "deactivate" && (
                <Button size="sm" onClick={applyDeactivate} disabled={selected.size === 0 || saving}>
                  {saving ? "Saving…" : deactivateLabel()}
                </Button>
              )}
              <Button size="xs" variant="ghost" onClick={exitMode}>Cancel</Button>
            </>
          )}
        </div>
      </div>
      {editError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{editError}</p>}
      <div className="border-t border-navy-100 mb-4" />

      {(mode !== "normal" || open) && (
        <>
          {showAdd && mode === "normal" && (
            <Card className="p-4 mb-4 max-w-md border border-sky-100">
              <div className="flex flex-col gap-3">
                <TextInput label="Type name" placeholder="e.g. Workshop" value={newName}
                  onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowAdd(false); }}
                  autoFocus />
                {addError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{addError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAdd} disabled={addSaving || !newName.trim()}>{addSaving ? "Adding…" : "Add"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                </div>
              </div>
            </Card>
          )}

          {mode === "deactivate" && types.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 mb-1 text-xs text-navy-400">
              <input type="checkbox"
                checked={selected.size === types.length && types.length > 0}
                onChange={() => setSelected(selected.size === types.length ? new Set() : new Set(types.map((t) => t.id)))}
                className="rounded border-navy-200 accent-sky-500" />
              <span>Select all</span>
            </div>
          )}

          <div className="space-y-1">
            {types.map((t) => (
              <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-white transition-colors ${mode === "deactivate" && selected.has(t.id) ? "border-sky-200 bg-sky-50" : "border-navy-100"}`}>
                {mode === "deactivate" && (
                  <input type="checkbox" checked={selected.has(t.id)}
                    onChange={() => { setSelected((prev) => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); }}
                    className="rounded border-navy-200 accent-sky-500 flex-shrink-0" />
                )}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {mode === "edit" ? (
                    <input value={editValues.get(t.id) ?? t.name}
                      onChange={(e) => setEditValues((m) => new Map([...m, [t.id, e.target.value]]))}
                      className="rounded-lg border border-navy-100 px-2 py-1 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-sky-300" />
                  ) : (
                    <span className="text-sm font-medium text-navy-700">{t.name}</span>
                  )}
                  <span className={`inline-block rounded-pill px-3 py-0.5 text-xs font-semibold ${t.is_active ? "bg-lime-100 text-lime-600" : "bg-navy-50 text-navy-300"}`}>
                    {t.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            ))}
            {types.length === 0 && <p className="text-navy-300 text-sm">No standalone program types yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgramTypeSection — expandable section for a parent type and its children
// ---------------------------------------------------------------------------

function ProgramTypeSection({
  parent,
  subTypes,
  createProgramType,
  updateProgramType,
}: {
  parent: ProgramType;
  subTypes: ProgramType[];
  createProgramType: (name: string, parentId?: number | null) => Promise<{ data: ProgramType | null; error: string | null }>;
  updateProgramType: (id: number, input: Partial<ProgramType>) => Promise<{ data: ProgramType | null; error: string | null }>;
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<Mode>("normal");
  const [editValues, setEditValues] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [editingParentName, setEditingParentName] = useState(false);
  const [parentNameValue, setParentNameValue] = useState(parent.name);
  const [parentNameError, setParentNameError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  function enterMode(m: Mode) {
    setMode(m); setSelected(new Set()); setEditError(null);
    setEditValues(m === "edit" ? new Map(subTypes.map((t) => [t.id, t.name])) : new Map());
  }

  function exitMode() {
    setMode("normal"); setSelected(new Set()); setEditValues(new Map()); setEditError(null);
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setAddSaving(true); setAddError(null);
    const { error } = await createProgramType(newName.trim(), parent.id);
    setAddSaving(false);
    if (error) { setAddError(error); } else { setNewName(""); setShowAdd(false); }
  }

  async function saveParentName() {
    if (!parentNameValue.trim() || parentNameValue.trim() === parent.name) {
      setEditingParentName(false); setParentNameError(null);
      return;
    }
    const { error } = await updateProgramType(parent.id, { name: parentNameValue.trim() });
    if (error) { setParentNameError(error); return; }
    setEditingParentName(false); setParentNameError(null);
  }

  async function saveEdits() {
    setSaving(true); setEditError(null);
    for (const t of subTypes) {
      const val = editValues.get(t.id)?.trim();
      if (val && val !== t.name) {
        const { error } = await updateProgramType(t.id, { name: val });
        if (error) { setEditError(`Couldn't rename "${t.name}": ${error}`); setSaving(false); return; }
      }
    }
    setSaving(false); exitMode();
  }

  async function applyDeactivate() {
    setSaving(true);
    for (const id of selected) {
      const t = subTypes.find((x) => x.id === id);
      if (t) await updateProgramType(id, { is_active: !t.is_active });
    }
    setSaving(false); exitMode();
  }

  function deactivateLabel() {
    const sel = subTypes.filter((t) => selected.has(t.id));
    if (sel.length === 0) return "Deactivate selected";
    if (sel.every((t) => t.is_active)) return `Deactivate ${sel.length} selected`;
    if (sel.every((t) => !t.is_active)) return `Activate ${sel.length} selected`;
    return `Update ${sel.length} selected`;
  }

  const inactiveCount = subTypes.filter((t) => !t.is_active).length;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {mode === "normal" && (
            <button type="button" onClick={() => { if (!open) { setOpen(true); return; } setShowAdd(false); setOpen(false); }}
              className="text-navy-300 hover:text-navy-600 text-xs w-4 flex-shrink-0 leading-none">
              {open ? "▼" : "▶"}
            </button>
          )}
          {editingParentName ? (
            <>
              <input value={parentNameValue} onChange={(e) => setParentNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveParentName(); if (e.key === "Escape") { setEditingParentName(false); setParentNameValue(parent.name); setParentNameError(null); } }}
                className="rounded-lg border border-navy-100 px-2 py-1 text-sm w-44 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-300" autoFocus />
              <button onClick={saveParentName} className="text-sky-400 font-medium text-sm">Save</button>
              <button onClick={() => { setEditingParentName(false); setParentNameValue(parent.name); setParentNameError(null); }} className="text-navy-300 text-sm">Cancel</button>
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold text-navy-700">{parent.name}</h3>
              <button onClick={() => { setEditingParentName(true); setParentNameValue(parent.name); setParentNameError(null); }}
                className="text-navy-300 hover:text-navy-600 text-sm leading-none" title="Rename section">✎</button>
              {inactiveCount > 0 && (
                <span className="text-xs text-navy-300 bg-navy-50 rounded-pill px-2 py-0.5">
                  {inactiveCount} inactive
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {mode === "normal" ? (
            <>
              <Button size="sm" className="flex items-center gap-1"
                onClick={() => { setShowAdd((v) => !v); setAddError(null); setNewName(""); if (!open) setOpen(true); }}>
                <IconPlus /> Add
              </Button>
              <Button size="xs" variant="ghost" onClick={() => { enterMode("edit"); setOpen(true); }}>Edit</Button>
              <Button size="xs" variant="ghost" onClick={() => { enterMode("deactivate"); setOpen(true); }}>Deactivate</Button>
            </>
          ) : (
            <>
              {mode !== "edit" && <span className="text-xs text-navy-400 font-medium">{selected.size} selected</span>}
              {mode === "edit" && (
                <Button size="sm" onClick={saveEdits} disabled={saving}>{saving ? "Saving…" : "Save all"}</Button>
              )}
              {mode === "deactivate" && (
                <Button size="sm" onClick={applyDeactivate} disabled={selected.size === 0 || saving}>
                  {saving ? "Saving…" : deactivateLabel()}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={exitMode}>Cancel</Button>
            </>
          )}
        </div>
      </div>
      {parentNameError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{parentNameError}</p>}
      {editError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{editError}</p>}

      {(mode !== "normal" || open) && (
        <>
          {showAdd && mode === "normal" && (
            <Card className="p-4 mb-3 max-w-md border border-sky-100">
              <div className="flex flex-col gap-3">
                <TextInput label="Sub-program name" placeholder="e.g. Academic Offline Work" value={newName}
                  onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowAdd(false); }}
                  autoFocus />
                {addError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{addError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAdd} disabled={addSaving || !newName.trim()}>{addSaving ? "Adding…" : "Add"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                </div>
              </div>
            </Card>
          )}

          {mode === "deactivate" && subTypes.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-1.5 mb-1 text-xs text-navy-400">
              <input type="checkbox"
                checked={selected.size === subTypes.length && subTypes.length > 0}
                onChange={() => setSelected(selected.size === subTypes.length ? new Set() : new Set(subTypes.map((t) => t.id)))}
                className="rounded border-navy-200 accent-sky-500" />
              <span>Select all</span>
            </div>
          )}

          <div className="space-y-1 pl-4 border-l-2 border-sky-100">
            {subTypes.map((t) => (
              <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white transition-colors ${mode === "deactivate" && selected.has(t.id) ? "border-sky-200 bg-sky-50" : "border-navy-100"}`}>
                {mode === "deactivate" && (
                  <input type="checkbox" checked={selected.has(t.id)}
                    onChange={() => { setSelected((prev) => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); }}
                    className="rounded border-navy-200 accent-sky-500 flex-shrink-0" />
                )}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {mode === "edit" ? (
                    <input value={editValues.get(t.id) ?? t.name}
                      onChange={(e) => setEditValues((m) => new Map([...m, [t.id, e.target.value]]))}
                      className="rounded-lg border border-navy-100 px-2 py-1 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-sky-300" />
                  ) : (
                    <span className="text-sm text-navy-700">{t.name}</span>
                  )}
                  <span className={`inline-block rounded-pill px-3 py-0.5 text-xs font-semibold ${t.is_active ? "bg-lime-100 text-lime-600" : "bg-navy-50 text-navy-300"}`}>
                    {t.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            ))}
            {subTypes.length === 0 && <p className="text-navy-300 text-sm py-2">No sub-programs yet. Add one above.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InactiveTab
// ---------------------------------------------------------------------------

function InactiveTab({
  types,
  updateProgramType,
}: {
  types: ProgramType[];
  updateProgramType: (id: number, input: Partial<ProgramType>) => Promise<{ data: ProgramType | null; error: string | null }>;
}) {
  const parentIds = new Set(types.filter((t) => t.parent_id !== null).map((t) => t.parent_id!));
  const inactiveStandalone = types.filter(
    (t) => t.parent_id === null && !t.is_active && !isSectionType(t, parentIds)
  );
  const inactiveSections = types.filter(
    (t) => t.parent_id === null && !t.is_active && isSectionType(t, parentIds)
  );
  const activeParentsWithInactiveChildren = types
    .filter((t) => t.parent_id === null && t.is_active && isSectionType(t, parentIds))
    .map((parent) => ({
      parent,
      inactiveChildren: types.filter((t) => t.parent_id === parent.id && !t.is_active),
    }))
    .filter((x) => x.inactiveChildren.length > 0);

  const nothing = inactiveStandalone.length === 0 && inactiveSections.length === 0 && activeParentsWithInactiveChildren.length === 0;

  if (nothing) {
    return <p className="text-navy-300 text-sm mt-2">Nothing inactive yet.</p>;
  }

  return (
    <div className="space-y-8">
      {inactiveStandalone.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">Inactive Standalone Types</h2>
          <div className="space-y-1">
            {inactiveStandalone.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-navy-100 bg-white">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-navy-500">{t.name}</span>
                  <span className="inline-block rounded-pill bg-navy-100 text-navy-400 px-2 py-0.5 text-xs">Inactive</span>
                </div>
                <button type="button" onClick={() => updateProgramType(t.id, { is_active: true })}
                  className="text-xs text-sky-500 hover:text-sky-600 font-medium px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors">
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {inactiveSections.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">Inactive Sections</h2>
          <div className="space-y-1">
            {inactiveSections.map((p) => (
              <div key={p.id} className="border border-navy-100 rounded-xl overflow-hidden bg-white">
                <div className="flex items-center justify-between px-4 py-3 bg-navy-50/40">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-navy-500">{p.name}</span>
                    <span className="inline-block rounded-pill bg-navy-100 text-navy-400 px-2 py-0.5 text-xs">Inactive section</span>
                  </div>
                  <button type="button" onClick={() => updateProgramType(p.id, { is_active: true })}
                    className="text-xs text-sky-500 hover:text-sky-600 font-medium px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors flex-shrink-0">
                    Reactivate section
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeParentsWithInactiveChildren.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">Inactive Sub-programs</h2>
          {activeParentsWithInactiveChildren.map(({ parent, inactiveChildren }) => (
            <div key={parent.id} className="mb-2 border border-navy-100 rounded-xl overflow-hidden bg-white">
              <div className="px-4 py-2.5 bg-navy-50/40">
                <span className="text-sm font-semibold text-navy-500">{parent.name}</span>
              </div>
              <div className="px-4 pb-3 pt-2 space-y-1">
                {inactiveChildren.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-navy-100 bg-navy-50/20">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-navy-700">{t.name}</span>
                      <span className="inline-block rounded-pill bg-navy-50 text-navy-300 px-2 py-0.5 text-xs font-semibold">Inactive</span>
                    </div>
                    <button type="button" onClick={() => updateProgramType(t.id, { is_active: true })}
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
// AdminProgramTypesPage
// ---------------------------------------------------------------------------

const TYPE_DISPLAY_ORDER: Record<string, number> = {
  academic: 0,
  beyond_academic: 1,
  college_counselling: 2,
  demo_lesson: 3,
  ascend_offline_work: 4,
  student_offline_work: 5,
};

// Types whose `type` field drives specific form behaviour — they are always
// treated as standalone even if they somehow acquired a group-like type value
// or still have leftover child rows (e.g. deactivated-not-deleted historical
// sub-programs, like College Counselling's retired College
// Counselling/College Essays sub-programs — see
// db/docs/SUBJECT_HIERARCHY.md §3b).
const BEHAVIORAL_TYPE_VALUES = new Set(['academic', 'beyond_academic', 'college_counselling', 'demo_lesson', 'ascend_offline_work']);

// A top-level type is a "section" (has sub-programs) if:
//   • it's NOT a behavioral type (those are always standalone, regardless of
//     children — a behavioral type's children, if any, are historical
//     leftovers, not an active grouping), AND either:
//   • it already has children in the DB, OR
//   • it was explicitly created as a section (type is non-null)
function isSectionType(t: ProgramType, parentIds: Set<number>): boolean {
  if (t.type !== null && BEHAVIORAL_TYPE_VALUES.has(t.type)) return false;
  return parentIds.has(t.id) || t.type !== null;
}

export default function AdminProgramTypesPage() {
  const { programTypes, loading, createProgramType, updateProgramType } = useProgramTypes();
  const [tab, setTab] = useState<Tab>("types");
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [addSectionSaving, setAddSectionSaving] = useState(false);
  const [addSectionError, setAddSectionError] = useState<string | null>(null);

  // Derive hierarchy
  const parentIds = new Set(
    programTypes.filter((t) => t.parent_id !== null).map((t) => t.parent_id!)
  );

  const sortedTopLevel = programTypes
    .filter((t) => t.parent_id === null && t.is_active)
    .sort((a, b) => {
      const ao = TYPE_DISPLAY_ORDER[a.type ?? ""] ?? 99;
      const bo = TYPE_DISPLAY_ORDER[b.type ?? ""] ?? 99;
      return ao !== bo ? ao - bo : a.name.localeCompare(b.name);
    });

  const standaloneTypes = sortedTopLevel.filter((t) => !isSectionType(t, parentIds));
  const sectionTypes = sortedTopLevel.filter((t) => isSectionType(t, parentIds));

  const subTypesFor = (parentId: number) =>
    programTypes.filter((t) => t.parent_id === parentId && t.is_active);

  const inactiveCount = programTypes.filter((t) => !t.is_active).length;

  async function handleAddSection() {
    if (!newSectionName.trim()) return;
    setAddSectionSaving(true); setAddSectionError(null);
    // type='group' marks this as a section immediately, even before sub-programs are added
    const { error } = await createProgramType(newSectionName.trim(), null, 'group');
    setAddSectionSaving(false);
    if (error) { setAddSectionError(error); } else { setNewSectionName(""); setShowAddSection(false); }
  }

  return (
    <AdminLayout>
      <PageHeader
        title="Program Types"
        description="Manage the program types teachers choose from when logging a session."
        action={
          <Button
            className="flex items-center gap-2"
            onClick={() => { setShowAddSection((v) => !v); setAddSectionError(null); setNewSectionName(""); }}
          >
            <IconPlus /> Add section
          </Button>
        }
      />

      <div className="flex gap-1 mb-6 border-b border-navy-100">
        {(["types", "inactive"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? "border-sky-400 text-sky-500" : "border-transparent text-navy-400 hover:text-navy-600"
            }`}>
            {t === "inactive" ? (
              <span className="flex items-center gap-1.5">
                Inactive
                {inactiveCount > 0 && (
                  <span className="inline-block bg-navy-100 text-navy-400 rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none">
                    {inactiveCount}
                  </span>
                )}
              </span>
            ) : "Program Types"}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      )}

      {!loading && tab === "types" && (
        <>
          {showAddSection && (
            <Card className="p-5 mb-6 max-w-md border border-sky-100">
              <p className="text-sm font-semibold text-navy-700 mb-3">New section</p>
              <p className="text-xs text-navy-400 mb-3">
                A section groups related sub-programs (e.g. "Student Offline Work" groups "Academic Offline Work" and "Beyond Academic Offline Work").
              </p>
              <div className="flex flex-col gap-3">
                <TextInput label="Section name" placeholder="e.g. Student Offline Work" value={newSectionName}
                  onChange={(e) => { setNewSectionName(e.target.value); setAddSectionError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); if (e.key === "Escape") setShowAddSection(false); }}
                  autoFocus />
                {addSectionError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{addSectionError}</p>
                )}
                <div className="flex gap-2">
                  <Button onClick={handleAddSection} disabled={addSectionSaving || !newSectionName.trim()}>
                    {addSectionSaving ? "Adding…" : "Add section"}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowAddSection(false)}>Cancel</Button>
                </div>
              </div>
            </Card>
          )}

          <StandaloneSection
            types={standaloneTypes}
            createProgramType={createProgramType}
            updateProgramType={updateProgramType}
          />

          {sectionTypes.length > 0 && (
            <div>
              <div className="mb-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-1">Sections with Sub-programs</h2>
                <div className="border-t border-navy-100" />
              </div>
              {sectionTypes.map((parent) => (
                <ProgramTypeSection
                  key={parent.id}
                  parent={parent}
                  subTypes={subTypesFor(parent.id)}
                  createProgramType={createProgramType}
                  updateProgramType={updateProgramType}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!loading && tab === "inactive" && (
        <InactiveTab types={programTypes} updateProgramType={updateProgramType} />
      )}
    </AdminLayout>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { IconPlus } from "../ui/icons";
import { useParents } from "../../hooks/useParents";
import { useStudents } from "../../hooks/useStudents";
import {
  childrenOf,
  parentDisplayName,
  parentMatchesSearch,
} from "../../utils/parentDirectory";
import type { Parent } from "../../types/database";

interface ParentPickerProps {
  label: string;
  value: string | null;
  /**
   * The full row comes back alongside the id, not just the id, because callers
   * need the parent's own name/phone to fill the student's guardian fields
   * from it (see applyParentToGuardianContact). `parent` is null when the link
   * is being cleared.
   */
  onChange: (parentId: string | null, parent: Parent | null) => void;
  /** Where "+ New parent" should send the admin back to once it's created. */
  returnTo?: string;
}

/**
 * Picks the household a student belongs to: search the parents already in the
 * system, or jump to /admin/parents/new to add one and come straight back with
 * it selected (per the repo rule that forms live on their own route, never as
 * an inline panel).
 *
 * Selecting an existing parent is what makes siblings share one account — the
 * children already under that parent are listed on the selected chip so an
 * admin can see at a glance they've picked the right family.
 *
 * Optional throughout: leaving it unset means the family has no parent login,
 * which is a perfectly ordinary state (and the only possible one for everyone
 * enrolled before parent accounts existed).
 */
export function ParentPicker({ label, value, onChange, returnTo }: ParentPickerProps) {
  const navigate = useNavigate();
  const { parents, loading } = useParents();
  const { students } = useStudents();
  const [search, setSearch] = useState("");

  const selected: Parent | null = value ? parents.find((p) => p.id === value) ?? null : null;

  const matches = useMemo(() => {
    const q = search.trim();
    if (!q) return [];
    return parents.filter((p) => parentMatchesSearch(p, q)).slice(0, 20);
  }, [parents, search]);

  const newParentHref = returnTo
    ? `/admin/parents/new?returnTo=${encodeURIComponent(returnTo)}`
    : "/admin/parents/new";

  return (
    <div>
      <label className="block text-xs font-medium text-navy-500 mb-1.5">{label}</label>

      {selected ? (
        <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-navy-700">
              {parentDisplayName(selected)}{" "}
              <span className="font-mono text-xs text-sky-500">{selected.id}</span>
            </p>
            <p className="text-xs text-navy-400 truncate">
              {[
                selected.email,
                childrenOf(students, selected.id)
                  .map((s) => `${s.first_name} ${s.last_name}`.trim())
                  .join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="text-xs text-navy-400 hover:text-red-500 shrink-0 ml-3"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search by name, email or parent ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 rounded-xl border border-navy-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(newParentHref)}
              className="flex items-center gap-1.5 shrink-0"
            >
              <IconPlus /> New parent
            </Button>
          </div>

          {search.trim() && !loading && matches.length === 0 && (
            <p className="text-xs text-navy-300 mt-2">No parent matches that.</p>
          )}

          {matches.length > 0 && (
            <div className="mt-2 border border-navy-50 rounded-xl max-h-64 overflow-y-auto">
              {matches.map((p) => {
                const kids = childrenOf(students, p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { onChange(p.id, p); setSearch(""); }}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-sky-50 transition-colors border-b border-navy-50 last:border-b-0"
                  >
                    <span className="text-sm text-navy-700">
                      {parentDisplayName(p)}{" "}
                      <span className="font-mono text-xs text-sky-500">{p.id}</span>
                    </span>
                    <span className="text-xs text-navy-300 truncate ml-2">
                      {kids.length > 0
                        ? kids.map((s) => `${s.first_name} ${s.last_name}`.trim()).join(", ")
                        : p.email ?? ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

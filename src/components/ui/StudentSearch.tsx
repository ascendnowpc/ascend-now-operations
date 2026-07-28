import { useState, useRef, useEffect } from "react";
import { useStudents } from "../../hooks/useStudents";
import type { Student } from "../../types/database";

interface Props {
  label?: string;
  value: string | null;
  onChange: (student: Student | null) => void;
  required?: boolean;
  /** When set, restricts search results (and the resolved selection) to this set of student IDs. */
  allowedIds?: Set<string>;
  /** Shown under the input when allowedIds is set and empty. */
  emptyAllowedMessage?: string;
}

function studentLabel(s: Student) {
  return `${s.id} — ${s.first_name} ${s.last_name}`;
}

export function StudentSearch({ label = "Student", value, onChange, required, allowedIds, emptyAllowedMessage }: Props) {
  const { students, searchStudents } = useStudents();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value != null ? (students.find((s) => s.id === value) ?? null) : null;

  useEffect(() => {
    if (selected) setQuery(studentLabel(selected));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = query && !selected
    ? searchStudents(query).filter((s) => !allowedIds || allowedIds.has(s.id))
    : [];

  function handleSelect(s: Student) {
    onChange(s);
    setQuery(studentLabel(s));
    setOpen(false);
  }

  function handleInputChange(v: string) {
    setQuery(v);
    onChange(null);
    setOpen(true);
  }

  function handleClear() {
    setQuery("");
    onChange(null);
    setOpen(false);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (value != null && selected) {
          setQuery(studentLabel(selected));
        }
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [value, selected]);

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium text-navy-500">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { if (query && !selected) setOpen(true); }}
          placeholder="Type student ID (e.g. S001) or name…"
          className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        {value != null && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-navy-300 hover:text-red-400 text-xl leading-none"
            aria-label="Clear student"
          >
            ×
          </button>
        )}

        {open && results.length > 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-navy-100 rounded-xl shadow-md max-h-52 overflow-y-auto">
            {results.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 text-navy-700"
              >
                <span className="font-mono font-medium text-sky-600">{s.id}</span>
                {" — "}
                {s.first_name} {s.last_name}
              </button>
            ))}
          </div>
        )}

        {open && query && !selected && results.length === 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-navy-100 rounded-xl shadow-md">
            <p className="px-3 py-2 text-sm text-red-500">
              No student found matching "{query}"
            </p>
          </div>
        )}
      </div>
      {allowedIds && allowedIds.size === 0 && emptyAllowedMessage && (
        <p className="text-xs text-amber-600">{emptyAllowedMessage}</p>
      )}
    </div>
  );
}

import { useState, useRef, useEffect, useMemo } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface Props {
  label?: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
}

// Generic searchable checkbox-dropdown multi-select. No equivalent existed
// in the component library — every other "multi" filter in the app is
// either a single native <select> or a comma-joined id string — so this is
// the one new reusable primitive the Analysis filters need.
export function MultiSelect({ label, options, selected, onChange, placeholder = "All", emptyMessage = "No options" }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  const selectedLabels = options.filter((o) => selectedSet.has(o.value)).map((o) => o.label);
  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
      ? selectedLabels.join(", ")
      : `${selectedLabels.length} selected`;

  return (
    <div ref={containerRef} className="flex flex-col gap-1 relative">
      {label && <label className="text-xs font-medium text-navy-500">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border border-navy-100 px-3 py-2 text-sm text-left bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 ${
          selectedLabels.length === 0 ? "text-navy-300" : "text-navy-700"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="flex items-center gap-1 shrink-0">
          {selectedLabels.length > 0 && (
            <span
              role="button"
              onClick={clear}
              className="text-navy-300 hover:text-red-400 text-base leading-none px-0.5"
              aria-label="Clear selection"
            >
              ×
            </span>
          )}
          <span className="text-navy-300 text-xs">▾</span>
        </span>
      </button>

      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-navy-100 rounded-xl shadow-md">
          {options.length > 6 && (
            <div className="p-2 border-b border-navy-50">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-navy-300">{options.length === 0 ? emptyMessage : "No matches"}</p>
            ) : (
              filtered.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-navy-700 hover:bg-sky-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(o.value)}
                    onChange={() => toggle(o.value)}
                    className="rounded border-navy-200 text-sky-500 focus:ring-sky-300"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

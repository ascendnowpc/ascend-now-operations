import { useRef, useState, useEffect } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface Props {
  label?: string;
  placeholder?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
  disabled?: boolean;
}

// A plain multi-select: a dropdown whose panel is a list of checkboxes. Closes
// on outside-click (same pattern as StudentSearch). The trigger shows the
// chosen labels, or the placeholder when nothing is picked.
export function MultiSelectDropdown({ label, placeholder = "Select…", options, value, onChange, required, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div className="flex flex-col gap-1.5" ref={containerRef}>
      {label && (
        <label className="text-sm font-medium text-navy-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-navy-100 px-3 py-2 text-sm text-left bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:bg-navy-50 disabled:text-navy-300"
        >
          <span className={selectedLabels.length ? "text-navy-700" : "text-navy-300"}>
            {selectedLabels.length ? selectedLabels.join(", ") : placeholder}
          </span>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-navy-400">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && !disabled && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-navy-100 rounded-xl shadow-md max-h-60 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-sm text-navy-300">No options.</p>
            ) : (
              options.map((o) => {
                const on = value.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-sky-50 text-navy-700"
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${on ? "bg-sky-500 border-sky-500 text-white" : "border-navy-200 bg-white"}`}>
                      {on && (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {o.label}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

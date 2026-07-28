export interface BeyondAcademicOption {
  value: string;
  label: string;
}

interface Props {
  label?: string;
  placeholder?: string;
  options: BeyondAcademicOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

// Beyond Academics subjects (Passion Projects, Career Exploration, Book
// Publishing, etc.) are picked from one flat dropdown -- no "Section" step,
// and no grouping/<optgroup> either. There is no hierarchy here at all:
// every Beyond Academic subject is a peer of every other one.
// See db/docs/SUBJECT_HIERARCHY.md for the full picture and every file that
// needs to change together if this hierarchy changes again.
export function BeyondAcademicSubjectSelect({
  label = "Subject",
  placeholder = "Select a subject…",
  options,
  value,
  onChange,
  required,
}: Props) {
  const inputId = label.toLowerCase().replace(/\s+/g, "-");
  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-navy-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        id={inputId}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-colors"
      >
        <option value="" disabled={!!required}>{placeholder}</option>
        {sorted.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

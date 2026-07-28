import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import { DIAL_CODES } from "../../data/countries";

interface FieldWrapperProps {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}

function FieldWrapper({ label, htmlFor, error, children, required }: FieldWrapperProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-navy-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextInput({ label, error, id, required, className = "", ...rest }: TextInputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldWrapper label={label} htmlFor={inputId} error={error} required={required}>
      <input
        id={inputId}
        required={required}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-navy-700 placeholder:text-navy-200 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-colors ${
          error ? "border-red-300" : "border-navy-100"
        } ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
}

interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectInput({
  label,
  error,
  id,
  required,
  options,
  placeholder,
  className = "",
  ...rest
}: SelectInputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldWrapper label={label} htmlFor={inputId} error={error} required={required}>
      <select
        id={inputId}
        required={required}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-colors ${
          error ? "border-red-300" : "border-navy-100"
        } ${className}`}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled={!!required}>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

interface PhoneInputProps {
  label: string;
  dialCode: string;
  onDialCodeChange: (code: string) => void;
  phoneNumber: string;
  onPhoneNumberChange: (val: string) => void;
  required?: boolean;
  error?: string;
}

export function PhoneInput({
  label,
  dialCode,
  onDialCodeChange,
  phoneNumber,
  onPhoneNumberChange,
  required,
  error,
}: PhoneInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-navy-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex gap-2">
        <DialCodeSelect value={dialCode} onChange={onDialCodeChange} />
        <input
          type="tel"
          value={phoneNumber}
          onChange={(e) => onPhoneNumberChange(e.target.value)}
          placeholder="Phone number"
          className={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm text-navy-700 placeholder:text-navy-200 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-colors ${
            error ? "border-red-300" : "border-navy-100"
          }`}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// Searchable dial-code picker. Replaces a plain <select> so the country-code
// list can be filtered by typing a code ("+44") or a country abbreviation
// ("UK") instead of scrolling. Selected value is stored as the bare dial code
// (e.g. "+1"); the label carries the country hint.
function DialCodeSelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = DIAL_CODES.find((d) => d.code === value) ?? null;
  const q = query.trim().toLowerCase();
  const results = q
    ? DIAL_CODES.filter((d) => d.label.toLowerCase().includes(q) || d.code.toLowerCase().includes(q))
    : DIAL_CODES;

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

  function handleSelect(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative w-44 shrink-0">
      <input
        type="text"
        value={open ? query : selected?.label ?? ""}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Code"
        className="w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-700 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-colors"
      />
      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-navy-100 rounded-lg shadow-md max-h-52 overflow-y-auto">
          {results.length > 0 ? (
            results.map((d) => (
              <button
                key={d.code}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(d.code); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-sky-50 ${
                  d.code === value ? "bg-sky-50 text-sky-600 font-medium" : "text-navy-700"
                }`}
              >
                {d.label}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-navy-300">No match</p>
          )}
        </div>
      )}
    </div>
  );
}

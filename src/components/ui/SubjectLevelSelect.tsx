import { useEffect, useState } from "react";
import { SelectInput } from "./Input";
import { groupSubjectsByBase } from "../../hooks/useCurriculumGroups";
import type { Subject } from "../../types/database";

interface Props {
  label?: string;
  subjects: Subject[];
  value: string;
  onChange: (subjectId: string) => void;
  required?: boolean;
  // Override the auto-generated "Select {label}…" / "Select level…" text —
  // e.g. a filter (not a required picker) wants "All subjects"/"All levels".
  placeholder?: string;
  levelPlaceholder?: string;
}

// Lets the user pick a subject by name once, then choose its level (e.g. SL/HL)
// from a separate dropdown, instead of seeing the same subject name listed once per level.
export function SubjectLevelSelect({ label = "Subject", subjects, value, onChange, required, placeholder, levelPlaceholder }: Props) {
  const groups = groupSubjectsByBase(subjects);
  const groupForValue = groups.find((g) => g.items.some((s) => String(s.id) === value));
  const [baseKey, setBaseKey] = useState(groupForValue?.key ?? "");

  useEffect(() => {
    if (!value) setBaseKey("");
  }, [value]);

  const activeGroup = groups.find((g) => g.key === baseKey) ?? groupForValue ?? null;
  const needsLevel = !!activeGroup && activeGroup.items.length > 1;

  function handleBaseChange(next: string) {
    setBaseKey(next);
    const g = groups.find((x) => x.key === next);
    onChange(g && g.items.length === 1 ? String(g.items[0].id) : "");
  }

  return (
    <div className="flex flex-col gap-2">
      <SelectInput
        label={label}
        placeholder={placeholder ?? `Select ${label.toLowerCase()}…`}
        value={baseKey}
        onChange={(e) => handleBaseChange(e.target.value)}
        options={groups.map((g) => ({ value: g.key, label: g.baseLabel }))}
        required={required}
      />
      {needsLevel && activeGroup && (
        <SelectInput
          label="Level"
          placeholder={levelPlaceholder ?? "Select level…"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={activeGroup.items.map((s) => ({ value: String(s.id), label: s.level || "—" }))}
          required={required}
        />
      )}
    </div>
  );
}

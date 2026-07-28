import type { ProgramType } from "../types/database";

// Shared label/formatting helpers for session-log filters and tables, used by
// both the admin/teacher SessionLogsListView and the student session logs
// view so the two can't drift out of sync on how a status/program/subject is
// labelled.

export const NO_SHOW_LABELS: Record<string, string> = {
  no_show_1: "No Show 1",
  no_show_2: "No Show 2",
  no_show_plus: "No Show +",
};

export const NO_SHOW_OPTIONS = [
  { value: "any", label: "Any no show" },
  { value: "no_show_1", label: "No Show 1" },
  { value: "no_show_2", label: "No Show 2" },
  { value: "no_show_plus", label: "No Show +" },
];

export const MONTHS = [
  { value: "1", label: "January" }, { value: "2", label: "February" },
  { value: "3", label: "March" }, { value: "4", label: "April" },
  { value: "5", label: "May" }, { value: "6", label: "June" },
  { value: "7", label: "July" }, { value: "8", label: "August" },
  { value: "9", label: "September" }, { value: "10", label: "October" },
  { value: "11", label: "November" }, { value: "12", label: "December" },
];

export const ENGAGEMENT_COLORS: Record<string, string> = {
  low: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-emerald-100 text-emerald-700",
};

export function currentYearOptions() {
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear + 1; y >= thisYear - 6; y--) {
    years.push({ value: String(y), label: String(y) });
  }
  return years;
}

export function getSessionSubjectLabel(
  subjectId: number | null,
  curriculumId: number | null,
  subjectLookup: Map<number, string>,
  curriculumLookup: Map<number, string>
): string {
  if (!subjectId) return "—";
  const sub = subjectLookup.get(subjectId) ?? "—";
  if (!curriculumId) return sub;
  const cur = curriculumLookup.get(curriculumId);
  return cur ? `${cur} – ${sub}` : sub;
}

export function getProgramTypeLabel(id: number | null, programTypes: ProgramType[]): string {
  if (!id) return "—";
  const pt = programTypes.find((p) => p.id === id);
  if (!pt) return "—";
  if (pt.parent_id) {
    const parent = programTypes.find((p) => p.id === pt.parent_id);
    if (parent) return `${parent.name} — ${pt.name}`;
  }
  return pt.name;
}

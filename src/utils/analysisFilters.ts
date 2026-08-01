import { type DateRangePreset, DEFAULT_DATE_RANGE_PRESET } from "./dateRangePresets";

export interface AnalysisFilters {
  preset: DateRangePreset;
  customFrom?: string;
  customTo?: string;
  teacherIds: string[];
  coordinatorIds: string[];
  countries: string[];
  studentIds: string[];
  noShowType?: "any" | "no_show_1" | "no_show_2" | "no_show_plus";
  flagged?: "yes" | "no";
  engagementRating?: "low" | "medium" | "high";
}

export function defaultAnalysisFilters(): AnalysisFilters {
  return {
    preset: DEFAULT_DATE_RANGE_PRESET,
    teacherIds: [],
    coordinatorIds: [],
    countries: [],
    studentIds: [],
  };
}

// Backs the "Clear filters" affordance — true whenever the dashboard is showing
// anything other than its default view.
export function hasActiveFilters(f: AnalysisFilters): boolean {
  return (
    f.preset !== DEFAULT_DATE_RANGE_PRESET ||
    f.teacherIds.length > 0 ||
    f.coordinatorIds.length > 0 ||
    f.countries.length > 0 ||
    f.studentIds.length > 0 ||
    Boolean(f.noShowType) ||
    Boolean(f.flagged) ||
    Boolean(f.engagementRating)
  );
}

// The students list's "Package status" filter, as a pure function.
//
// The unit a status is computed over is the thing the student BOUGHT, not the
// row in `student_packages`. A bundle — Foundation Program or All-In-One — is
// one purchase that fans out into several pool rows (Primary Project, Extra
// Hours, Career Exploration, ...), all sharing a `package_type_id`. Scoring
// each pool on its own made a barely-touched All-In-One read as "100%+ used"
// the moment its smallest pool ran out, so the filter put those students in
// the wrong bucket entirely. Pools of one bundle are therefore summed into a
// single unit; an ordinary standalone package (`package_type_id` null) is its
// own unit, as before.

export type PackageStatus =
  | "none"
  | "under_50"
  | "between_50_75"
  | "between_75_100"
  | "completed_or_over";

export const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  none: "No package",
  under_50: "< 50% used (healthy)",
  between_50_75: "50–75% used",
  between_75_100: "75–99% used (running low)",
  completed_or_over: "100%+ used (done / exceeded)",
};

export interface PackageUsageRow {
  /** The bundle this pool belongs to, or null for a standalone package. */
  package_type_id: number | null;
  total_hours_purchased: number | string;
  hours_used: number | string;
}

export interface UsageUnit {
  /** The bundle's id, or `standalone:<index>` for an ungrouped package. */
  key: string;
  purchased: number;
  used: number;
}

// `student_packages.total_hours_purchased` / `hours_used` are numerics, which
// PostgREST returns as strings — coerce rather than trusting the type.
function num(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Groups a student's package rows into the units a status is judged over: one
 * per bundle (pools summed), one per standalone package.
 */
export function usageUnits(packages: readonly PackageUsageRow[]): UsageUnit[] {
  const byBundle = new Map<string, UsageUnit>();
  const units: UsageUnit[] = [];

  packages.forEach((pkg, index) => {
    const purchased = num(pkg.total_hours_purchased);
    const used = num(pkg.hours_used);

    if (pkg.package_type_id == null) {
      units.push({ key: `standalone:${index}`, purchased, used });
      return;
    }
    const key = `bundle:${pkg.package_type_id}`;
    const existing = byBundle.get(key);
    if (existing) {
      existing.purchased += purchased;
      existing.used += used;
      return;
    }
    const unit: UsageUnit = { key, purchased, used };
    byBundle.set(key, unit);
    units.push(unit);
  });

  return units;
}

/** Where a single usage fraction falls among the status bands. */
export function statusForFraction(fraction: number): PackageStatus {
  if (fraction >= 1) return "completed_or_over";
  if (fraction >= 0.75) return "between_75_100";
  if (fraction >= 0.5) return "between_50_75";
  return "under_50";
}

/**
 * A student's package status: the worst (highest) usage across their units —
 * so a student with one nearly-spent package still surfaces under "running
 * low" even if their other packages are fresh. No packages at all = "none".
 */
export function packageStatusOf(packages: readonly PackageUsageRow[]): PackageStatus {
  const units = usageUnits(packages);
  if (units.length === 0) return "none";

  let worst = 0;
  for (const unit of units) {
    // A unit with no purchased hours can't be a fraction of anything; treat it
    // as 0% rather than dividing by zero.
    const fraction = unit.purchased > 0 ? unit.used / unit.purchased : 0;
    if (fraction > worst) worst = fraction;
  }
  return statusForFraction(worst);
}

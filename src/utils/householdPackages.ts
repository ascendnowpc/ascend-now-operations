import type { StudentPackage } from "../types/database";

// One answer to "whose package is this", used by every screen that lists
// packages — the admin's Learner's actual hours, a family's own page, the
// parents list — so none of them can quietly disagree or forget that a package
// might be shared.
//
// There is only ever ONE packages table. What differs is who draws on a row:
//   * an INDIVIDUAL package names its student in `student_packages.student_id`.
//   * a SHARED package names the household in `student_packages.parent_id` and
//     its two children in `student_package_members`.
//
// Everything here takes the members map alongside the packages and hands back
// plain student ids, so callers never branch on which ownership column is set.
// That branching is exactly what made a shared pool invisible on Learner's
// actual hours until 2026-09-13.

/** The members map as every caller builds it: package id → student ids. */
export type PackageMembers = Map<number, string[]>;

export function membersByPackage(
  rows: { student_package_id: number; student_id: string }[],
): PackageMembers {
  const map: PackageMembers = new Map();
  for (const row of rows) {
    const ids = map.get(row.student_package_id) ?? [];
    ids.push(row.student_id);
    map.set(row.student_package_id, ids);
  }
  return map;
}

/**
 * Every student who draws on a package.
 *
 * One id for an individual package, two for a shared one. A shared package
 * whose members haven't loaded yet comes back empty rather than pretending it
 * belongs to nobody in particular — callers show it as shared either way.
 */
export function packageStudentIds(
  pkg: Pick<StudentPackage, "id" | "student_id" | "parent_id">,
  members: PackageMembers,
): string[] {
  if (pkg.student_id != null) return [pkg.student_id];
  return members.get(pkg.id) ?? [];
}

/** True when more than one student draws on it — i.e. it is parent-owned. */
export function isSharedPackage(pkg: Pick<StudentPackage, "parent_id">): boolean {
  return pkg.parent_id != null;
}

/**
 * The packages one student can draw on: their own, plus the shared pools they
 * are named on.
 *
 * The client-side mirror of the `student_package_ids()` SQL helper the
 * session-log router and RLS both go through, so what a screen lists and what
 * the database will actually spend are the same set.
 */
export function packagesForStudent<T extends Pick<StudentPackage, "id" | "student_id" | "parent_id">>(
  packages: T[],
  members: PackageMembers,
  studentId: string,
): T[] {
  return packages.filter((p) => packageStudentIds(p, members).includes(studentId));
}

/**
 * Every package belonging to a household, counted ONCE.
 *
 * A shared pool is drawn on by two children, so listing per child and adding
 * up would count its hours twice. This is the set to total a family by.
 */
export function householdPackages<T extends Pick<StudentPackage, "id" | "student_id" | "parent_id">>(
  packages: T[],
  members: PackageMembers,
  childIds: string[],
): T[] {
  const ids = new Set(childIds);
  return packages.filter((p) => packageStudentIds(p, members).some((id) => ids.has(id)));
}

export interface PackageHours {
  purchased: number;
  used: number;
  /** Clamped per package, so an overspent one can't eat another's balance. */
  remaining: number;
}

/**
 * Purchased / used / remaining across a set of packages.
 *
 * Remaining is clamped per package rather than on the total, matching the
 * per-row figure every package card shows: a pool that has gone over is 0 left,
 * not a negative that quietly offsets a healthy pool somewhere else.
 */
export function totalPackageHours(
  packages: Pick<StudentPackage, "total_hours_purchased" | "hours_used">[],
): PackageHours {
  return packages.reduce<PackageHours>(
    (totals, p) => {
      const purchased = p.total_hours_purchased ?? 0;
      const used = p.hours_used ?? 0;
      return {
        purchased: totals.purchased + purchased,
        used: totals.used + used,
        remaining: totals.remaining + Math.max(purchased - used, 0),
      };
    },
    { purchased: 0, used: 0, remaining: 0 },
  );
}

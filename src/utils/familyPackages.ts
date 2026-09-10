import type { StudentPackage, Student } from "../types/database";
import { idSeqNumber } from "./entityId";

// Family packages: a pool bought once by a parent and drawn down by every
// sibling. The rules that decide who owns a pool, who may spend from it, and
// how a shared pool's usage splits between children live here rather than in
// the components, so the admin view, the parent view and each student's own
// view can never disagree about the same numbers.
//
// See supabase/migrations/20260911000000_family_packages.sql — the database
// enforces the same ownership rule with a CHECK constraint, and routes session
// logs to family pools with the matching `student_package_ids()` helper.

/** A pool owned by a parent, shared by every child linked to them. */
export function isFamilyPackage(pkg: Pick<StudentPackage, "parent_id">): boolean {
  return pkg.parent_id != null;
}

/**
 * The pools a student may draw on: their own, plus their family's.
 *
 * Mirrors the `student_package_ids()` SQL helper the session-log trigger uses,
 * so what the UI shows a student they can spend and what the database actually
 * lets them spend are the same set.
 */
export function packagesAvailableToStudent(
  packages: StudentPackage[],
  student: Pick<Student, "id" | "parent_id">,
): StudentPackage[] {
  return packages.filter(
    (p) =>
      p.student_id === student.id ||
      (p.parent_id != null && student.parent_id != null && p.parent_id === student.parent_id),
  );
}

export interface SiblingUsage {
  studentId: string;
  firstName: string;
  lastName: string;
  sessions: number;
  noShows: number;
  hours: number;
}

export interface PackageUsageSplit {
  /** Per-sibling slices, largest first, then by id so the order is stable. */
  slices: (SiblingUsage & {
    /** Share of the package's PURCHASED hours, 0-100, for the usage bar. */
    percent: number;
  })[];
  usedHours: number;
  purchasedHours: number;
  remainingHours: number;
  /** Purchased hours nobody has spent yet, 0-100. */
  remainingPercent: number;
  /** True once spending has passed what was bought. */
  overspent: boolean;
}

/**
 * Splits a package's usage between the children who spent it.
 *
 * Percentages are of the hours PURCHASED, not of the hours used, so the bar
 * reads as "how much of the package has gone, and to whom" rather than as a
 * pie of past spending — two siblings at 25% each on a half-used package is
 * the useful picture.
 *
 * Overspending is reported rather than hidden: when usage exceeds what was
 * bought the slices are normalised to the total used so they still fill the
 * bar exactly once, and `overspent` says so. A package with nothing purchased
 * (the zero-hour pool the session trigger creates to make an overage visible)
 * is the same case.
 */
export function packageUsageSplit(
  usage: SiblingUsage[],
  purchasedHours: number,
): PackageUsageSplit {
  const usedHours = usage.reduce((sum, u) => sum + u.hours, 0);
  const overspent = usedHours > purchasedHours;
  // What the percentages are taken out of: normally the purchased total, but
  // the used total once spending has passed it (or when nothing was bought),
  // so the slices never overflow the bar.
  const denominator = overspent ? usedHours : purchasedHours;

  const slices = [...usage]
    .sort((a, b) => b.hours - a.hours || a.studentId.localeCompare(b.studentId))
    .map((u) => ({
      ...u,
      percent: denominator > 0 ? (u.hours / denominator) * 100 : 0,
    }));

  return {
    slices,
    usedHours,
    purchasedHours,
    remainingHours: Math.max(purchasedHours - usedHours, 0),
    remainingPercent: overspent || purchasedHours <= 0
      ? 0
      : ((purchasedHours - usedHours) / purchasedHours) * 100,
    overspent,
  };
}

// The colour a given child's hours are drawn in. Assigned by position within
// the family rather than randomly or by hashing a name, so the eldest is
// always the first colour and a child keeps their colour across every screen —
// the admin's package card, the parent's dashboard, and each sibling's own.
//
// Tailwind can't see class names built at runtime, so each entry is a complete
// literal string. Six colours then wrap; a family with seven children reusing a
// colour is a far smaller problem than a seventh child rendering unstyled.
export interface SiblingColor {
  /** Solid fill for the usage bar. */
  bar: string;
  /** Small legend dot. */
  dot: string;
  /** Pill background + text for a legend chip. */
  chip: string;
}

const SIBLING_COLORS: SiblingColor[] = [
  { bar: "bg-sky-500", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 border-sky-100" },
  { bar: "bg-lime-500", dot: "bg-lime-500", chip: "bg-lime-50 text-lime-700 border-lime-100" },
  { bar: "bg-violet-500", dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700 border-violet-100" },
  { bar: "bg-amber-500", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-100" },
  { bar: "bg-rose-500", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 border-rose-100" },
  { bar: "bg-teal-500", dot: "bg-teal-500", chip: "bg-teal-50 text-teal-700 border-teal-100" },
];

/**
 * Maps each child in a family to a stable colour.
 *
 * `orderedStudentIds` must be the family's children in a stable order — the
 * enrollment order `childrenOf()` returns — so a child's colour doesn't move
 * when a sibling is added, or when one of them happens to have used no hours
 * on the package being drawn.
 */
export function siblingColorMap(orderedStudentIds: string[]): Map<string, SiblingColor> {
  const map = new Map<string, SiblingColor>();
  orderedStudentIds.forEach((id, i) => {
    map.set(id, SIBLING_COLORS[i % SIBLING_COLORS.length]);
  });
  return map;
}

/**
 * The family's children in colour order, derived from usage rows alone.
 *
 * A student cannot read their sibling's `students` row — RLS shows them only
 * their own — so on their own dashboard the only place a sibling's id appears
 * is the usage RPC. Ordering by the id's trailing sequence number (the
 * enrollment order, readable straight off the id text) reproduces exactly the
 * order `childrenOf()` gives an admin or a parent, so the same child is the
 * same colour on every screen without anyone needing extra read access.
 *
 * Taken across ALL the family's packages, not per package: a sibling who spent
 * nothing on one pool must not shuffle everyone's colours on that card.
 */
export function familyColorOrder(usageByPackage: Iterable<SiblingUsage[]>): string[] {
  const ids = new Set<string>();
  for (const rows of usageByPackage) {
    for (const row of rows) ids.add(row.studentId);
  }
  return Array.from(ids).sort((a, b) => idSeqNumber(a) - idSeqNumber(b) || a.localeCompare(b));
}

/** The fallback for a student who isn't in the family list (shouldn't happen). */
export const UNKNOWN_SIBLING_COLOR: SiblingColor = {
  bar: "bg-navy-300",
  dot: "bg-navy-300",
  chip: "bg-navy-50 text-navy-500 border-navy-100",
};

export function siblingColor(
  map: Map<string, SiblingColor>,
  studentId: string,
): SiblingColor {
  return map.get(studentId) ?? UNKNOWN_SIBLING_COLOR;
}

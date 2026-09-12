import type { CourseType } from "../types/database";
import { formatHours } from "./formatHours";

// The rules behind "shared or individual?" — the first question the add-package
// form asks, and everything that follows from the answer.
//
// A package is bought one of two ways:
//   * INDIVIDUAL — owned by one student, any course type, exactly as before.
//   * SHARED — bought once by a household and drawn down by TWO named
//     children. Only the course types the business actually sells that way can
//     be shared, and the parent never picks the pair: an admin assigns them.
//
// See supabase/migrations/20260912000000_shared_package_members.sql — the
// database enforces the same two rules (validate_shared_package_course_type()
// and validate_student_package_member()), so a form that let either slip
// through would fail at the insert rather than write bad data.

/** How many children share one shared package. */
export const SHARED_PACKAGE_STUDENT_COUNT = 2;

export type PackageOwnership = "individual" | "shared";

/**
 * The course types that can be bought as a shared package.
 *
 * Read off `course_types.is_shareable` rather than a name list held here, so
 * the business can sell a new programme as shared by flipping one row — the
 * same column the database's own guard checks. Bundles (Foundation Program /
 * All-In-One) are never shareable: they contain a College Counselling pool,
 * which is bought per child.
 */
export function shareableCourseTypes(courseTypes: CourseType[]): CourseType[] {
  return courseTypes
    .filter((ct) => ct.is_active && ct.is_shareable)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function isShareableCourseType(
  courseTypes: CourseType[],
  courseTypeId: number | "",
): boolean {
  if (courseTypeId === "") return false;
  return shareableCourseTypes(courseTypes).some((ct) => ct.id === courseTypeId);
}

/**
 * What the list page says once the package is created.
 *
 * Names the children on a shared package, because "50 hrs added" alone doesn't
 * say which two of the household can spend them — the one fact an admin
 * assigning the pair needs to see confirmed back.
 */
export function packageCreatedNotice(opts: {
  hours: number;
  ownership: PackageOwnership;
  studentNames: string[];
}): string {
  const hrs = `${formatHours(opts.hours)} hrs added`;
  if (opts.ownership === "individual") {
    return opts.studentNames[0] ? `${hrs} for ${opts.studentNames[0]}.` : `${hrs}.`;
  }
  return opts.studentNames.length > 0
    ? `${hrs} — shared by ${joinNames(opts.studentNames)}.`
    : `${hrs}.`;
}

/** "A and B" for two, "A, B and C" beyond — the pair is the only case today. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A database rejection, said in words an admin can act on.
 *
 * The three that a correctly-filled form can still hit are all real states
 * rather than mistakes in the form: a pool of that type is already open for
 * this owner, or one of the two shared-package triggers fired. Postgres states
 * them as a constraint name, which tells an admin nothing about what to do
 * next. Anything unrecognised is passed through untouched — a made-up
 * paraphrase of an unknown failure is worse than the raw text.
 */
export function packageCreateErrorMessage(raw: string): string {
  if (raw.includes("student_packages_one_current_per_family_course_type")) {
    return "This family already has an open pool of that course type. Add hours to it instead of creating a second one.";
  }
  if (raw.includes("student_packages_one_current_per_course_type")) {
    return "This student already has an open package of that course type. Add hours to it instead of creating a second one.";
  }
  return raw;
}

// ── Selling a shared package against an invoice ──────────────────────────
//
// Both places a shared package can be created start from ONE student and ask
// who else shares it, rather than starting from a household and picking two
// children out of it:
//   * the Add package form — find the student, and their siblings appear.
//   * an enrollment request's package line — the student the invoice is for may
//     not exist yet (a new-student enrollment creates them only on confirm), so
//     the line stores only the OTHER child and the confirm step adds the
//     enrolling student alongside them.
// Either way the chosen student is a member by definition and only the
// co-sharers are chosen, which is why one set of rules serves both.

/** How many OTHER children a shared package line names. */
export const SHARED_PACKAGE_CO_SHARER_COUNT = SHARED_PACKAGE_STUDENT_COUNT - 1;

/**
 * The children a package line can be shared WITH.
 *
 * Everyone in the household except the chosen student — they are a member by
 * definition and must not be pickable as their own co-sharer (the database
 * refuses that row outright). `enrollingStudentId` is null on a new-student
 * enrollment, where nobody is excluded because the new child isn't in the list
 * yet.
 */
export function coSharerCandidates<T extends { id: string }>(
  children: T[],
  enrollingStudentId: string | null,
): T[] {
  return children.filter((c) => c.id !== enrollingStudentId);
}

/**
 * Whether "Shared" can be offered for this student at all.
 *
 * It needs a household and at least one other child in it to share with. An
 * only child, or a student with no parent account, can only buy individually —
 * and the form says so rather than offering a choice the database would refuse.
 */
export function canSellShared<T extends { id: string }>(
  parentId: string | null,
  children: T[],
  enrollingStudentId: string | null,
): boolean {
  return !!parentId && coSharerCandidates(children, enrollingStudentId).length >= SHARED_PACKAGE_CO_SHARER_COUNT;
}

/**
 * Why a shared package isn't ready yet, as the message to show, or null when
 * it is.
 */
export function sharedLineIssue<T extends { id: string }>(
  parentId: string | null,
  children: T[],
  enrollingStudentId: string | null,
  coSharerIds: string[],
): string | null {
  if (!parentId) return "Pick the family this student belongs to before sharing a package.";
  const candidates = coSharerCandidates(children, enrollingStudentId);
  if (candidates.length < SHARED_PACKAGE_CO_SHARER_COUNT) {
    return `A shared package needs ${SHARED_PACKAGE_STUDENT_COUNT} children — this family has no one else to share with.`;
  }
  const valid = coSharerIds.filter((id) => candidates.some((c) => c.id === id));
  if (valid.length !== SHARED_PACKAGE_CO_SHARER_COUNT) {
    return `Select ${SHARED_PACKAGE_CO_SHARER_COUNT === 1 ? "the other child" : `${SHARED_PACKAGE_CO_SHARER_COUNT} other children`} to share with.`;
  }
  return null;
}

/**
 * Picks (or unpicks) a child to share a package with.
 *
 * Clicking the selected child clears them. Clicking another one takes a free
 * slot, and when the slots are full the OLDEST pick makes way —
 * deliberately so: there is one co-sharer slot, and ignoring the click would
 * just read as a broken control rather than as "you already chose".
 */
export function pickCoSharer(selected: string[], studentId: string): string[] {
  if (selected.includes(studentId)) return selected.filter((id) => id !== studentId);
  const room = [...selected, studentId];
  return room.slice(Math.max(room.length - SHARED_PACKAGE_CO_SHARER_COUNT, 0));
}

/**
 * The "shared with" line on an invoice, or null when the package is
 * individual.
 *
 * A parent paying for hours two children will spend should see that on the
 * invoice — an Academic package that reads identically to a single-child one
 * is the sort of thing that gets queried after the fact.
 */
export function sharedWithLabel(isShared: boolean, coSharerNames: string[]): string | null {
  if (!isShared) return null;
  return coSharerNames.length > 0 ? `Shared with ${joinNames(coSharerNames)}` : "Shared";
}

/**
 * Whether a shared pool is shared by exactly the children you mean to add
 * hours for.
 *
 * Order-independent, because "who shares this pool" is a set — the rows come
 * back in whatever order the database gives them, and the pair was picked in
 * whatever order the admin clicked. Used to decide whether hours may be added
 * to an existing pool at all: topping up a pool shared with a DIFFERENT pair
 * would put hours somewhere nobody asked for, and they cannot be taken back.
 */
export function sameSharedMembers(have: string[], want: string[]): boolean {
  if (have.length !== want.length) return false;
  const a = [...have].sort();
  const b = [...want].sort();
  return a.every((id, i) => id === b[i]);
}

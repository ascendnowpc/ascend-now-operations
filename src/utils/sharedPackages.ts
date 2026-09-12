import type { CourseType, Student } from "../types/database";
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
 * Adds or removes a child from the pair a shared package goes to.
 *
 * Clicking a selected child removes them. Clicking a new one adds them only
 * while there is room — once two are picked, a third click is ignored rather
 * than silently dropping whichever child was picked first, so an admin never
 * loses a selection they can't see they lost. The form disables the remaining
 * children at that point; this is the guard behind that.
 */
export function toggleSharedStudent(selected: string[], studentId: string): string[] {
  if (selected.includes(studentId)) return selected.filter((id) => id !== studentId);
  if (selected.length >= SHARED_PACKAGE_STUDENT_COUNT) return selected;
  return [...selected, studentId];
}

/** Whether a child may still be picked — false for the ones a full pair locks out. */
export function canSelectSharedStudent(selected: string[], studentId: string): boolean {
  return selected.includes(studentId) || selected.length < SHARED_PACKAGE_STUDENT_COUNT;
}

/**
 * Why the pair isn't valid yet, as the message to show, or null when it is.
 *
 * A one-child household is the case worth naming outright: nothing the admin
 * does on this form can fix it, so "pick 2 children" would just be a dead end.
 */
export function sharedSelectionIssue(
  children: Pick<Student, "id">[],
  selected: string[],
): string | null {
  if (children.length < SHARED_PACKAGE_STUDENT_COUNT) {
    return `A shared package needs ${SHARED_PACKAGE_STUDENT_COUNT} children — this family has ${children.length}.`;
  }
  // Only children of THIS family count; a stale selection left behind by
  // switching parents mid-form must not satisfy the check.
  const valid = selected.filter((id) => children.some((c) => c.id === id));
  if (valid.length !== SHARED_PACKAGE_STUDENT_COUNT) {
    return `Select ${SHARED_PACKAGE_STUDENT_COUNT} children.`;
  }
  return null;
}

/**
 * The selection carried across a change of parent: nothing.
 *
 * Picking a different family invalidates every child already ticked — the
 * database rejects a member who isn't a child of the owning parent — so the
 * form clears rather than carrying ids that would fail at insert.
 */
export function sharedStudentsForParent(
  selected: string[],
  children: Pick<Student, "id">[],
): string[] {
  return selected.filter((id) => children.some((c) => c.id === id));
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
// The add-package form knows both children up front. The enrollment flow
// doesn't: the student the invoice is FOR may not exist yet (a new-student
// enrollment creates them only when the payment is confirmed), so a package
// line stores only the OTHER child — the co-sharer — and the confirm step adds
// the enrolling student alongside them.

/** How many OTHER children a shared package line names. */
export const SHARED_PACKAGE_CO_SHARER_COUNT = SHARED_PACKAGE_STUDENT_COUNT - 1;

/**
 * The children a package line can be shared WITH.
 *
 * Everyone in the household except the student being invoiced — they are a
 * member by definition and must not be pickable as their own co-sharer (the
 * database refuses that row outright). `enrollingStudentId` is null on a
 * new-student enrollment, where nobody is excluded because the new child isn't
 * in the list yet.
 */
export function coSharerCandidates<T extends { id: string }>(
  children: T[],
  enrollingStudentId: string | null,
): T[] {
  return children.filter((c) => c.id !== enrollingStudentId);
}

/**
 * Whether "Shared" can be offered on this enrollment at all.
 *
 * It needs a household and at least one other child in it to share with. A
 * family with one child, or a student with no parent account, can only buy
 * individually — and the form says so rather than offering a choice that would
 * fail at confirm.
 */
export function canSellShared<T extends { id: string }>(
  parentId: string | null,
  children: T[],
  enrollingStudentId: string | null,
): boolean {
  return !!parentId && coSharerCandidates(children, enrollingStudentId).length >= SHARED_PACKAGE_CO_SHARER_COUNT;
}

/**
 * Why a shared package line isn't ready to invoice, as the message to show, or
 * null when it is.
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
 * Picks (or unpicks) a child to share a package line with.
 *
 * Clicking the selected child clears them. Clicking another one takes a free
 * slot, and when the slots are full the OLDEST pick makes way — the opposite
 * of `toggleSharedStudent`, and deliberately: there is one co-sharer slot, so
 * ignoring the click the way the two-slot picker does would just read as a
 * broken control rather than as "you already chose".
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

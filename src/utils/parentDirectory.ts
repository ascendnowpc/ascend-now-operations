import type { Parent, Student } from "../types/database";
import { idSeqNumber } from "./entityId";

// Pure lookup/labelling helpers shared by the admin Parents list, the parent
// picker on the enroll form, and the parent dashboard's own child switcher.
// Kept out of the components so the rules that actually matter — who counts as
// a child, what a search matches, how a family is named — are testable and
// stated once.

export function parentDisplayName(parent: Pick<Parent, "first_name" | "last_name">): string {
  return `${parent.first_name} ${parent.last_name}`.trim();
}

// What the parent picker shows in a dropdown: enough to tell two families with
// the same surname apart without opening anything. The id is included because
// it is what the admin sees on the student record afterwards.
export function parentPickerLabel(parent: Pick<Parent, "id" | "first_name" | "last_name" | "email">): string {
  const name = parentDisplayName(parent);
  return parent.email ? `${name} · ${parent.email} (${parent.id})` : `${name} (${parent.id})`;
}

// A parent's children, in enrollment order (the trailing sequence number of
// the student id — same ordering useStudents applies to the full list, so a
// family reads in the order the children were enrolled rather than
// alphabetically by whoever happens to be first).
export function childrenOf(students: Student[], parentId: string | null | undefined): Student[] {
  if (!parentId) return [];
  return students
    .filter((s) => s.parent_id === parentId)
    .sort((a, b) => idSeqNumber(a.id) - idSeqNumber(b.id));
}

// Free-text search across the fields an admin would actually type: the
// mnemonic id, either name part, the full name (so "sarah khan" matches even
// though no single column holds it), email and phone. An empty query matches
// everything — the list is not hidden until you search.
export function parentMatchesSearch(parent: Parent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    parent.id,
    parent.first_name,
    parent.last_name,
    parentDisplayName(parent),
    parent.email ?? "",
    parent.phone_number ?? "",
  ].some((field) => field.toLowerCase().includes(q));
}

// Whether this email already belongs to a parent account — the check that stops
// a sibling's enrollment creating a second account for the same family. Matched
// case-insensitively and trimmed, because an admin retyping an address rarely
// reproduces the original casing. Mirrors the same guard the
// create-parent-with-user edge function enforces server-side; this one exists so
// the form can say so before submitting.
export function findParentByEmail(parents: Parent[], email: string): Parent | null {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  return parents.find((p) => (p.email ?? "").trim().toLowerCase() === needle) ?? null;
}

// The guardian's name/phone as they should read once a student is linked to a
// parent ACCOUNT. Until 2026-09-10 the two were entirely independent — the
// account carried its own name/phone and `students.parent_full_name` /
// `parent_phone_number` carried theirs, so an admin had to type the same
// details twice and the two could silently disagree. Linking an account now
// fills those fields from it: the account is the source of truth for who the
// guardian is.
//
// Two deliberate edges:
//   * A parent with no phone on file does NOT wipe a phone already typed on
//     the student — filling in from the account should never lose contact
//     info the account happens not to have.
//   * Unlinking (parent = null) leaves both fields exactly as they are. A
//     family can stop having a login and still have a name and a number.
export interface GuardianContact {
  fullName: string;
  phone: string | null;
}

export function applyParentToGuardianContact(
  current: GuardianContact,
  parent: Pick<Parent, "first_name" | "last_name" | "phone_number"> | null,
): GuardianContact {
  if (!parent) return current;
  const parentPhone = (parent.phone_number ?? "").trim();
  return {
    fullName: parentDisplayName(parent),
    phone: parentPhone || current.phone,
  };
}

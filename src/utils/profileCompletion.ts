import type { Student, Teacher } from "../types/database";

// A student's required-at-first-login fields — deliberately never required
// at admin add/renewal time (see the enrollment form / enrollment_requests).
// A field admin already captured is never asked again. As of 2026-07-07
// this also covers curriculum, address/country, the guardian's name/phone,
// and the "send emails to" address — everything the student/parent
// dashboard merge asks for up front, short of the optional report-card
// upload (handled separately).
export function studentNeedsProfileCompletion(
  student: Pick<Student, "phone_number" | "graduation_year" | "birthday" | "school" | "curriculum" | "address" | "country" | "parent_full_name" | "parent_phone_number" | "notification_email">
): boolean {
  return (
    !student.phone_number ||
    student.graduation_year == null ||
    !student.birthday ||
    !student.school ||
    !student.curriculum ||
    !student.address ||
    !student.country ||
    !student.parent_full_name ||
    !student.parent_phone_number ||
    !student.notification_email
  );
}

// A teacher's required-at-first-login fields — deliberately never required
// at admin add time (only first name is required there; last name, email,
// phone, and country are all optional so admin can add a teacher without
// knowing every detail up front). This is where they actually get collected,
// mirroring studentNeedsProfileCompletion() above. first_name isn't checked
// here since admin's add-teacher form already requires it (and the DB
// column is NOT NULL), so it can never be the reason this returns true.
export function teacherNeedsProfileCompletion(
  teacher: Pick<Teacher, "last_name" | "email" | "phone_number" | "country">
): boolean {
  return (
    !teacher.last_name ||
    !teacher.email ||
    !teacher.phone_number ||
    !teacher.country
  );
}

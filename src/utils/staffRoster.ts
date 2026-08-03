/**
 * Whose students are mine — across BOTH assignment tables.
 *
 * A College Counsellor sees everything a Performance Coach sees, and that
 * includes the same "My Students" page rather than a cut-down roster of their
 * own. The only thing that differs between the two roles is which table the
 * assignment lives in, so this is the one place that knows about both:
 * `pc_student_assignments` for a coach, `cc_student_assignments` for a
 * counsellor, and the union for someone flagged as both.
 *
 * Mirrors `is_my_assigned_student()` on the database side (see
 * `20260808000000_cc_gets_pc_access.sql`) — the UI must not offer a student
 * that RLS will refuse.
 */

interface PcAssignmentRow {
  student_id: string;
  pc_teacher_id: string;
  unassigned_at: string | null;
}

interface CcAssignmentRow {
  student_id: string;
  cc_teacher_id: string;
  unassigned_at: string | null;
}

export interface StaffRoster {
  /**
   * Students with a *live* assignment to me — who I may act on right now
   * (change status, file a renewal request, write a log).
   */
  active: Set<string>;
  /**
   * Everyone who belongs on my list: `active` plus students I completed.
   * Completing a student closes their assignment, so they'd otherwise vanish
   * from the person who saw them through and the Completed tab would always
   * be empty.
   */
  visible: Set<string>;
}

/**
 * Both assignment lists are expected newest-first (the order
 * `usePcAssignments` / `useCcAssignments` fetch in), so the first row matching
 * a student is their latest assignment. That matters for a student who changed
 * coach or counsellor before finishing: they belong to whoever actually saw
 * them through, not to an earlier one.
 */
export function myRosterStudentIds(opts: {
  teacherId: string | null | undefined;
  isCoach: boolean;
  isCounsellor: boolean;
  pcAssignments: PcAssignmentRow[];
  ccAssignments: CcAssignmentRow[];
  students: { id: string; status: string }[];
}): StaffRoster {
  const { teacherId, isCoach, isCounsellor, pcAssignments, ccAssignments, students } = opts;

  const active = new Set<string>();
  if (!teacherId) return { active, visible: new Set(active) };

  if (isCoach) {
    for (const a of pcAssignments) {
      if (a.pc_teacher_id === teacherId && a.unassigned_at === null) active.add(a.student_id);
    }
  }
  if (isCounsellor) {
    for (const a of ccAssignments) {
      if (a.cc_teacher_id === teacherId && a.unassigned_at === null) active.add(a.student_id);
    }
  }

  const visible = new Set(active);
  for (const s of students) {
    if (s.status !== "completed") continue;
    const latestPc = isCoach ? pcAssignments.find((a) => a.student_id === s.id) : undefined;
    const latestCc = isCounsellor ? ccAssignments.find((a) => a.student_id === s.id) : undefined;
    if (latestPc?.pc_teacher_id === teacherId || latestCc?.cc_teacher_id === teacherId) {
      visible.add(s.id);
    }
  }

  return { active, visible };
}

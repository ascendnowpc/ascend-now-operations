// Pure aggregation logic behind every hours/revenue report — extracted from
// buildInvoicePdf so it can be unit-tested without pulling in jsPDF. The PDF
// builders, ReportSectionsView, useInvoices and AdminReportsPage all share
// these functions so a stored invoice and a live period render identically.

// ── Report sections (course-type / package-pool grouping) ────────────────────
// A report is grouped top-level by "section" — a standalone package's course
// type (Academic, College Counselling, …) or one pool of a Foundation
// Program / All-In-One bundle. Within a section, hours break down by subject
// (curriculum shown inline) then by teacher. This replaces the old
// curriculum-first grouping, which left everything non-academic under a
// single "No curriculum" heading and gave no per-package breakdown.

// session_count on every one of these is completed sessions only — a No
// Show + still deducts its hour (folded into `hours`) but is counted
// separately via noShowCount, never as a "session" (matching the
// sessionCountLabel convention used across the app — see utils/noShow.ts).
export type ReportTeacherRow = { teacherName: string; hours: number; session_count: number; noShowCount: number };
export type ReportSubjectRow = {
  subject_id: number | null;
  subjectName: string;      // "—" when a session has no subject (e.g. some College Counselling)
  subjectLevel: string | null;
  curriculumName: string | null;
  hours: number;
  session_count: number;
  noShowCount: number;
  teachers: ReportTeacherRow[];
};
export type ReportSection = {
  key: string;
  sectionName: string;      // pool label (bundle) or course type name (standalone)
  bundleName: string | null; // set only when this section is one pool of a bundle
  courseTypeName: string;
  hours: number;
  session_count: number;
  noShowCount: number;
  subjects: ReportSubjectRow[];
  // Same teachers as `subjects[].teachers`, but merged across every subject
  // in this section — backs a section's own "Sessions & Hours by Teacher"
  // table, kept separate from the "Hours by Subject" table rather than
  // nesting one inside the other (see ReportSectionsView/drawSectionTable).
  teachers: ReportTeacherRow[];
};

// One raw (already name-resolved) contribution to a report — one teacher's
// hours on one subject within one package/course-type. Both producers (stored
// invoice line items, and live-session period details) normalize to this.
export type ReportRawLine = {
  student_package_id: number | null;
  course_type_id: number | null;
  subject_id: number | null;
  subjectName: string | null;
  subjectLevel: string | null;
  curriculumName: string | null;
  // Program type — used as the row label (and split key) when a line has no
  // subject, e.g. College Counselling / College Essays sessions.
  program_type_id: number | null;
  programTypeName: string | null;
  teacherName: string;
  hours: number;
  session_count: number;
  // True when this line is a No Show + deduction rather than a completed
  // session — the hour still counts toward `hours`, but is tracked as its
  // own noShowCount rather than folded into session_count.
  isNoShow: boolean;
};

export type PackageMeta = { course_type_id: number; package_type_id: number | null; pool_label: string | null };

// Resolves which section a line belongs to. A line on a bundle pool
// (package_type_id set) becomes a section named after the pool, tagged with
// the bundle; anything else becomes a plain course-type section. Falls back
// to the line's own course_type_id when no package is linked (legacy rows).
export function resolveReportSection(
  studentPackageId: number | null,
  courseTypeId: number | null,
  packageById: Map<number, PackageMeta>,
  courseTypeName: (id: number | null) => string,
): { key: string; sectionName: string; bundleName: string | null; courseTypeName: string } {
  const pkg = studentPackageId != null ? packageById.get(studentPackageId) : undefined;
  if (pkg && pkg.package_type_id != null) {
    const ctName = courseTypeName(pkg.course_type_id);
    return {
      key: `pkg:${studentPackageId}`,
      sectionName: pkg.pool_label ?? ctName,
      bundleName: courseTypeName(pkg.package_type_id),
      courseTypeName: ctName,
    };
  }
  if (pkg) {
    const ctName = courseTypeName(pkg.course_type_id);
    return { key: `pkg:${studentPackageId}`, sectionName: ctName, bundleName: null, courseTypeName: ctName };
  }
  const ctName = courseTypeName(courseTypeId);
  return { key: `ct:${courseTypeId ?? "none"}`, sectionName: ctName, bundleName: null, courseTypeName: ctName };
}

// Merges one raw line's hours/counts into a teacher-row accumulator map,
// creating the row on first sight. Shared by the per-subject and per-section
// teacher aggregations below so a teacher who taught the same section under
// several subjects still collapses to one row per table.
function accumulateTeacherRow(teachers: Map<string, ReportTeacherRow>, l: ReportRawLine) {
  let t = teachers.get(l.teacherName);
  if (!t) {
    t = { teacherName: l.teacherName, hours: 0, session_count: 0, noShowCount: 0 };
    teachers.set(l.teacherName, t);
  }
  t.hours += l.hours;
  if (l.isNoShow) t.noShowCount += l.session_count; else t.session_count += l.session_count;
}

// Aggregates raw lines into sorted sections (section → subject → teacher,
// plus a section-wide teacher rollup). Bundle pools sort adjacently (by
// bundle, then by hours) so the renderer can group them into one block with
// a combined total. No-show hours (isNoShow) still count toward `hours` at
// every level (the package really did lose that hour) but are tracked via
// noShowCount instead of session_count, so a report can show them as a
// distinct, labeled breakdown rather than indistinguishable "hours taught".
export function aggregateReportSections(
  lines: ReportRawLine[],
  resolve: (spid: number | null, ctid: number | null) => { key: string; sectionName: string; bundleName: string | null; courseTypeName: string },
): ReportSection[] {
  type SubjAccum = ReportSubjectRow & { _teachers: Map<string, ReportTeacherRow> };
  const sections = new Map<string, ReportSection & { _subjects: Map<string, SubjAccum>; _teachers: Map<string, ReportTeacherRow> }>();
  for (const l of lines) {
    const meta = resolve(l.student_package_id, l.course_type_id);
    let sec = sections.get(meta.key);
    if (!sec) {
      sec = { key: meta.key, sectionName: meta.sectionName, bundleName: meta.bundleName, courseTypeName: meta.courseTypeName, hours: 0, session_count: 0, noShowCount: 0, subjects: [], teachers: [], _subjects: new Map(), _teachers: new Map() };
      sections.set(meta.key, sec);
    }
    sec.hours += l.hours;
    if (l.isNoShow) sec.noShowCount += l.session_count; else sec.session_count += l.session_count;
    accumulateTeacherRow(sec._teachers, l);

    // A line with no subject (e.g. College Counselling) is labeled and keyed
    // by its program type instead, so College Counselling and College Essays
    // stay as separate named rows rather than merging into one "—".
    const hasSubject = l.subject_id != null || l.subjectName != null;
    const label = hasSubject ? (l.subjectName ?? "—") : (l.programTypeName ?? "—");
    const subKey = hasSubject
      ? `s:${l.subject_id ?? l.subjectName ?? ""}|${l.curriculumName ?? ""}`
      : `p:${l.program_type_id ?? l.programTypeName ?? ""}`;
    let subj = sec._subjects.get(subKey);
    if (!subj) {
      subj = { subject_id: l.subject_id, subjectName: label, subjectLevel: hasSubject ? l.subjectLevel : null, curriculumName: hasSubject ? l.curriculumName : null, hours: 0, session_count: 0, noShowCount: 0, teachers: [], _teachers: new Map() };
      sec._subjects.set(subKey, subj);
    }
    subj.hours += l.hours;
    if (l.isNoShow) subj.noShowCount += l.session_count; else subj.session_count += l.session_count;
    accumulateTeacherRow(subj._teachers, l);
  }

  return Array.from(sections.values())
    .map((s) => ({
      key: s.key,
      sectionName: s.sectionName,
      bundleName: s.bundleName,
      courseTypeName: s.courseTypeName,
      hours: s.hours,
      session_count: s.session_count,
      noShowCount: s.noShowCount,
      subjects: Array.from(s._subjects.values())
        .map((sub) => ({
          subject_id: sub.subject_id,
          subjectName: sub.subjectName,
          subjectLevel: sub.subjectLevel,
          curriculumName: sub.curriculumName,
          hours: sub.hours,
          session_count: sub.session_count,
          noShowCount: sub.noShowCount,
          teachers: Array.from(sub._teachers.values()).sort((a, b) => b.hours - a.hours),
        }))
        .sort((a, b) => b.hours - a.hours),
      teachers: Array.from(s._teachers.values()).sort((a, b) => b.hours - a.hours),
    }))
    // Group bundle pools together (by bundle name), then by hours descending.
    .sort((a, b) => {
      const ab = a.bundleName ?? a.sectionName;
      const bb = b.bundleName ?? b.sectionName;
      if (ab !== bb) return ab < bb ? -1 : 1;
      return b.hours - a.hours;
    });
}

// Groups sections into render blocks: all pools of one bundle become a single
// block (rendered with a combined total in its header and each pool as a
// sub-section); every standalone section is its own block.
export type ReportBlock = { title: string; bundleName: string | null; hours: number; session_count: number; noShowCount: number; sections: ReportSection[] };
export function groupSectionsIntoBlocks(sections: ReportSection[]): ReportBlock[] {
  const blocks = new Map<string, ReportBlock>();
  for (const s of sections) {
    const bk = s.bundleName ?? s.key;
    let block = blocks.get(bk);
    if (!block) {
      block = { title: s.bundleName ?? s.sectionName, bundleName: s.bundleName, hours: 0, session_count: 0, noShowCount: 0, sections: [] };
      blocks.set(bk, block);
    }
    block.hours += s.hours;
    block.session_count += s.session_count;
    block.noShowCount += s.noShowCount;
    block.sections.push(s);
  }
  return Array.from(blocks.values());
}

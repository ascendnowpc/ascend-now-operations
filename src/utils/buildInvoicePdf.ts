import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Student } from "../types/database";
import { formatHours } from "./formatHours";
import { subjectLabel } from "./subjectLabel";
import { sessionCountLabel } from "./noShow";
import { ASCEND_LOGO_PNG_BASE64, ASCEND_LOGO_WATERMARK_BASE64 } from "../assets/ascendLogoBase64";

const NAVY = [36, 50, 107] as const;     // #24326B
const NAVY_DARK = [22, 28, 61] as const; // #161C3D
const SKY = [64, 176, 229] as const;     // #40B0E5
const SKY_LIGHT = [235, 246, 253] as const; // #EBF6FD
const GREY = [110, 120, 150] as const;

const MARGIN_X = 14;
const PAGE_WIDTH = 210; // A4 portrait, mm

function drawHeader(doc: jsPDF, opts: { title: string; subtitle: string }) {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_WIDTH, 30, "F");
  doc.setFillColor(...SKY);
  doc.rect(0, 30, PAGE_WIDTH, 1.4, "F");
  try {
    // This logo variant (white wordmark on a dark navy plate) is built for
    // dark headers, so it can go straight on the navy band with no backing.
    const logoW = 40;
    const logoH = logoW * (86 / 338);
    const logoX = MARGIN_X;
    const logoY = (30 - logoH) / 2;
    doc.addImage(ASCEND_LOGO_PNG_BASE64, "PNG", logoX, logoY, logoW, logoH);
  } catch {
    // Logo failed to decode — fall back to text-only header.
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.title, PAGE_WIDTH - MARGIN_X, 15, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(opts.subtitle, PAGE_WIDTH - MARGIN_X, 21, { align: "right" });
  doc.setTextColor(0, 0, 0);
  return 38;
}

// Stamps a faint, centered logo on every page as a background watermark.
// Drawn last (so it overlays rather than underlays content) at very low
// opacity so it reads as a watermark without obscuring text or tables.
function drawWatermark(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  const w = 130;
  const h = w * (152 / 820); // preserve the watermark logo's native aspect ratio
  const x = (PAGE_WIDTH - w) / 2;
  const y = (pageHeight - h) / 2;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gState = new (doc as any).GState({ opacity: 0.05 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).setGState(gState);
    try {
      doc.addImage(ASCEND_LOGO_WATERMARK_BASE64, "PNG", x, y, w, h);
    } catch {
      // Watermark is decorative only — ignore failures.
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).setGState(new (doc as any).GState({ opacity: 1 }));
  }
}

function drawFooter(doc: jsPDF) {
  drawWatermark(doc);
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const h = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text("Ascend Now", MARGIN_X, h - 10);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_WIDTH - MARGIN_X, h - 10, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }
}

function drawLearnerDetails(doc: jsPDF, student: Student, y: number): number {
  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Parent / Learner Details", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 9.5, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: "bold", textColor: NAVY_DARK as [number, number, number], cellWidth: 38 } },
    body: [
      ["Parent Full Name", student.parent_full_name ?? "—"],
      ["Phone Number", student.phone_number ?? "—"],
      ["Email", student.email ?? "—"],
      ["Learner Name", `${student.first_name} ${student.last_name}`],
      ["Address", student.address ?? "—"],
      ["Country", student.country ?? "—"],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6;
}

export type EnrollmentInvoicePackageLine = {
  courseTypeName: string;
  packageSizeLabel: string;
  hours: number;
};

export type EnrollmentInvoiceData = {
  kindLabel: string; // "New Enrollment" | "Package Renewal"
  parentFullName: string | null;
  phoneNumber: string | null;
  email: string;
  learnerName: string;
  address: string | null;
  country: string | null;
  // One or more packages on this single invoice — an admin can sell/renew
  // several packages for the same student in one request (added 2026-07-25),
  // in which case this lists every one of them plus a total-hours row.
  packages: EnrollmentInvoicePackageLine[];
  coordinatorName: string;
  note?: string | null;
};

// Builds the invoice PDF attached to the enrollment-workflow email (new
// student or renewal) — same header/footer/table styling as the other
// report PDFs above: a contact-details table, then a package table (one row
// per package, since a single invoice can now cover more than one).
export function buildEnrollmentInvoicePdf(data: EnrollmentInvoiceData): jsPDF {
  const doc = new jsPDF();
  let y = drawHeader(doc, {
    title: "Invoice",
    subtitle: `${data.kindLabel} · Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
  });

  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Invoice Information", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 9.5, cellPadding: 1.4 },
    columnStyles: { 0: { fontStyle: "bold", textColor: NAVY_DARK as [number, number, number], cellWidth: 44 } },
    body: [
      ["Parent Full Name", data.parentFullName ?? "—"],
      ["Phone Number", data.phoneNumber ?? "—"],
      ["Email", data.email],
      ["Learner (Student) Name", data.learnerName],
      ["Address", data.address ?? "—"],
      ["Country", data.country ?? "—"],
      ["Performance Coach", data.coordinatorName],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text(data.packages.length > 1 ? "Packages" : "Package", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  const totalHours = data.packages.reduce((sum, p) => sum + p.hours, 0);
  autoTable(doc, {
    startY: y,
    theme: "striped",
    head: [["Course Type", "Package", "Hours"]],
    headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 9.5 },
    styles: { fontSize: 9.5 },
    body: data.packages.map((p) => [p.courseTypeName, p.packageSizeLabel, `${p.hours} hrs`]),
    foot: data.packages.length > 1 ? [["", "Total", `${totalHours} hrs`]] : undefined,
    footStyles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  if (data.note) {
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GREY);
    doc.text(`Note: ${data.note}`, MARGIN_X, y);
    doc.setTextColor(0, 0, 0);
  }

  drawFooter(doc);
  return doc;
}

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

export type SessionLogRow = {
  date: string;
  teacherName: string;
  subjectName: string | null;
  subjectLevel: string | null;
  curriculumName: string | null;
  hours: number;
  noShow: boolean;
  topic: string | null;
};

function drawSessionLogTable(doc: jsPDF, sessionLog: SessionLogRow[], y: number): number {
  if (y > 250) { doc.addPage(); y = 18; }
  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Full Session Log", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: "striped",
    head: [["Date", "Teacher", "Subject", "Curriculum", "Hours", "Status"]],
    headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 8.5 },
    body: sessionLog.map((s) => [
      new Date(s.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      s.teacherName,
      s.subjectName ? subjectLabel(s.subjectName, s.subjectLevel) : "—",
      s.curriculumName ?? "—",
      s.noShow ? "—" : `${formatHours(s.hours)} hrs`,
      s.noShow ? "No-show" : "Completed",
    ]),
    bodyStyles: { fontSize: 8 },
    columnStyles: { 4: { halign: "right" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6;
}

const SUBJECT_BAND = [239, 246, 252] as const; // very light sky for subject rows
const TABLE_LINE = [226, 232, 240] as const;
const NO_SHOW_RED = [180, 60, 40] as const; // same no-show accent used in the teacher report below

// Small bold label drawn above a table ("Hours by Subject" / "Sessions &
// Hours by Teacher") so each table reads as its own labeled breakdown.
function drawTableLabel(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text(text, MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  return y + 4;
}

// Draws one section (a standalone course type, or a single bundle pool) as a
// navy title bar followed by two separate, clearly labeled tables — "Hours
// by Subject" and "Sessions & Hours by Teacher" (the latter merged across
// every subject in the section, not nested under each subject row) — rather
// than one table mixing both row grains via indentation. Mirrors the
// on-screen ReportSectionsView split so the PDF and the app never disagree.
// Returns the y after both tables.
function drawSectionTable(doc: jsPDF, section: ReportSection, opts: { title: string; subtitle: string | null }, y: number): number {
  const titleText = opts.subtitle ? `${opts.title}   ·   ${opts.subtitle}` : opts.title;
  const totalText = `${sessionCountLabel(section.session_count, section.noShowCount)}  ·  ${formatHours(section.hours)} hrs`;

  doc.setFillColor(...NAVY);
  doc.roundedRect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 9, 1, 1, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(titleText, MARGIN_X + 3, y + 6.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(totalText, PAGE_WIDTH - MARGIN_X - 3, y + 6.2, { align: "right" });
  doc.setTextColor(0, 0, 0);
  y += 13;

  // Table 1: Hours by Subject
  y = drawTableLabel(doc, "Hours by Subject", y);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: "grid",
    styles: { cellPadding: 2.4, lineColor: TABLE_LINE as [number, number, number], lineWidth: 0.1 },
    head: [[
      { content: "Program / Subject", styles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold", fontSize: 8.5 } },
      { content: "Sessions", styles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold", fontSize: 8.5, halign: "center" } },
      { content: "Hours", styles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold", fontSize: 8.5, halign: "right" } },
    ]],
    body: section.subjects.map((subj) => [
      { content: subjectLabel(subj.subjectName, subj.subjectLevel) + (subj.curriculumName ? `  ·  ${subj.curriculumName}` : ""), styles: { fontStyle: "bold", fillColor: SUBJECT_BAND as [number, number, number], textColor: NAVY_DARK as [number, number, number] } },
      { content: sessionCountLabel(subj.session_count, subj.noShowCount), styles: { halign: "center", fillColor: SUBJECT_BAND as [number, number, number], textColor: (subj.noShowCount > 0 ? NO_SHOW_RED : NAVY_DARK) as [number, number, number] } },
      { content: `${formatHours(subj.hours)} hrs`, styles: { halign: "right", fontStyle: "bold", fillColor: SUBJECT_BAND as [number, number, number], textColor: NAVY_DARK as [number, number, number] } },
    ]),
    bodyStyles: { fontSize: 9, textColor: NAVY_DARK as [number, number, number] },
    columnStyles: { 1: { halign: "center", cellWidth: 30 }, 2: { halign: "right", cellWidth: 28 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // Table 2: Sessions & Hours by Teacher — merged across every subject in
  // this section (ReportSection.teachers from aggregateReportSections),
  // kept as its own table rather than indented sub-rows under each subject.
  if (section.teachers.length > 0) {
    if (y > 260) { doc.addPage(); y = 18; }
    y = drawTableLabel(doc, "Sessions & Hours by Teacher", y);
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN_X, right: MARGIN_X },
      theme: "grid",
      styles: { cellPadding: 2.2, lineColor: TABLE_LINE as [number, number, number], lineWidth: 0.1, fontSize: 8.5 },
      head: [[
        { content: "Teacher", styles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold", fontSize: 8.5 } },
        { content: "Sessions", styles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold", fontSize: 8.5, halign: "center" } },
        { content: "Hours", styles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold", fontSize: 8.5, halign: "right" } },
      ]],
      body: section.teachers.map((t) => [
        { content: t.teacherName, styles: { textColor: GREY as [number, number, number] } },
        { content: sessionCountLabel(t.session_count, t.noShowCount), styles: { halign: "center", textColor: (t.noShowCount > 0 ? NO_SHOW_RED : GREY) as [number, number, number] } },
        { content: `${formatHours(t.hours)} hrs`, styles: { halign: "right", textColor: GREY as [number, number, number] } },
      ]),
      columnStyles: { 1: { halign: "center", cellWidth: 30 }, 2: { halign: "right", cellWidth: 28 } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY;
  }

  return y;
}

// Draws every report block. A standalone block is a single section table. A
// bundle (Foundation Program / All-In-One) gets a group header bar showing its
// combined total, then each pool as its own separate table with spacing
// between them, so nothing is crammed into one nested table.
export function drawReportBlocks(doc: jsPDF, blocks: ReportBlock[], startY: number): number {
  let y = startY;
  for (const block of blocks) {
    const isBundle = block.bundleName != null;

    if (isBundle) {
      if (y > 240) { doc.addPage(); y = 18; }
      // Bundle group header bar with combined total.
      doc.setFillColor(...NAVY_DARK);
      doc.roundedRect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 10, 1.5, 1.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(block.title, MARGIN_X + 4, y + 6.6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`${sessionCountLabel(block.session_count, block.noShowCount)}  ·  ${formatHours(block.hours)} hrs combined`, PAGE_WIDTH - MARGIN_X - 4, y + 6.6, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y += 14;

      for (const sec of block.sections) {
        if (y > 252) { doc.addPage(); y = 18; }
        const subtitle = sec.sectionName === sec.courseTypeName ? null : sec.courseTypeName;
        y = drawSectionTable(doc, sec, { title: sec.sectionName, subtitle }, y) + 6;
      }
      y += 4;
    } else {
      const sec = block.sections[0];
      if (y > 252) { doc.addPage(); y = 18; }
      y = drawSectionTable(doc, sec, { title: block.title, subtitle: null }, y) + 10;
    }
  }
  return y;
}

// Builds a PDF for one already-generated invoice (a historical snapshot of its
// period's line items), as opposed to buildInvoicePdf's whole-student current-balance PDF.
// Optionally appends a full per-session log table (e.g. for a package invoice
// where the underlying sessions are useful to keep alongside the summary).
export function buildSingleInvoicePdf(opts: {
  student: Student;
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  sections: ReportSection[];
  sessionLog?: SessionLogRow[];
}) {
  const { student, periodStart, periodEnd, totalHours, sections, sessionLog } = opts;
  const doc = new jsPDF();
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  let y = drawHeader(doc, {
    title: "Report",
    subtitle: `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`,
  });

  y = drawLearnerDetails(doc, student, y);

  // Total banner
  doc.setFillColor(...SKY_LIGHT);
  doc.roundedRect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 12, 2, 2, "F");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Total Hours Reported", MARGIN_X + 4, y + 8);
  doc.setFontSize(12);
  doc.text(`${formatHours(totalHours)} hrs`, PAGE_WIDTH - MARGIN_X - 4, y + 8, { align: "right" });
  doc.setTextColor(0, 0, 0);
  y += 18;

  if (sections.length === 0) {
    doc.setFontSize(9.5);
    doc.setTextColor(...GREY);
    doc.text("No sessions in this period.", MARGIN_X, y);
    doc.setTextColor(0, 0, 0);
  } else {
    y = drawReportBlocks(doc, groupSectionsIntoBlocks(sections), y);
  }

  if (sessionLog && sessionLog.length > 0) {
    drawSessionLogTable(doc, sessionLog, y);
  }

  drawFooter(doc);
  doc.save(`report_${student.id}_${periodStart}_${periodEnd}.pdf`);
}

// Standalone "view full session log" PDF for a package (or set of packages),
// independent of any specific invoice — a raw export of every matching session.
export function buildSessionLogPdf(opts: {
  student: Student;
  title: string;
  sessionLog: SessionLogRow[];
}) {
  const { student, title, sessionLog } = opts;
  const doc = new jsPDF();
  let y = drawHeader(doc, { title: "Session Log", subtitle: title });
  y = drawLearnerDetails(doc, student, y);
  drawSessionLogTable(doc, sessionLog, y);
  drawFooter(doc);
  doc.save(`session_log_${student.id}.pdf`);
}

export type MonthlyRevenueStatRow = { studentName?: string; teacherName?: string; sessions: number; hours: number };

// Builds a full monthly breakdown PDF for the admin Reports > Monthly Revenue
// tab: overall totals for the selected month plus a per-student hours table,
// mirroring the branding used for student invoices.
export function buildMonthlyRevenuePdf(opts: {
  year: number;
  month: number;
  totalHours: number;
  totalSessions: number;
  uniqueStudents: number;
  noShowCount: number;
  studentStats: MonthlyRevenueStatRow[];
}) {
  const { year, month, totalHours, totalSessions, uniqueStudents, noShowCount, studentStats } = opts;
  const monthLabel = new Date(year, month - 1).toLocaleString("en-GB", { month: "long", year: "numeric" });

  const doc = new jsPDF();
  let y = drawHeader(doc, {
    title: "Monthly Revenue Report",
    subtitle: monthLabel,
  });

  // Summary banner
  doc.setFillColor(...SKY_LIGHT);
  doc.roundedRect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 16, 2, 2, "F");
  const summary: [string, string][] = [
    ["Total Hours", `${formatHours(totalHours)} hrs`],
    ["Sessions", String(totalSessions)],
    ["Active Students", String(uniqueStudents)],
    ["No-shows", String(noShowCount)],
  ];
  const colWidth = (PAGE_WIDTH - MARGIN_X * 2) / summary.length;
  summary.forEach(([label, value], i) => {
    const cx = MARGIN_X + colWidth * i + colWidth / 2;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY_DARK);
    doc.text(value, cx, y + 7, { align: "center" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GREY);
    doc.text(label, cx, y + 12.5, { align: "center" });
  });
  doc.setTextColor(0, 0, 0);
  y += 22;

  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Student Hours Breakdown", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "striped",
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Student", "Sessions", "Hours"]],
    headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 9.5 },
    body: studentStats.length > 0
      ? studentStats.map((s) => [s.studentName ?? "—", String(s.sessions), `${formatHours(s.hours)} hrs`])
      : [["No sessions logged this month.", "", ""]],
    foot: studentStats.length > 0 ? [["Total", String(totalSessions), `${formatHours(totalHours)} hrs`]] : undefined,
    footStyles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold" },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: "center" }, 2: { halign: "right", fontStyle: "bold" } },
  });
  drawFooter(doc);
  doc.save(`monthly-revenue-report_${year}-${String(month).padStart(2, "0")}.pdf`);
}

export type ReportSubjectBreakdownRow = {
  subjectName: string;
  subjectLevel: string | null;
  curriculumName: string | null;
  programTypeName?: string | null;
  sessions: number;
  hours: number;
};
export type ReportTeacherBreakdown = { teacherName: string; rows: ReportSubjectBreakdownRow[] };
export type ReportStudentBreakdown = { studentName: string; rows: ReportSubjectBreakdownRow[] };

function drawReportBreakdownTable(doc: jsPDF, opts: {
  title: string;
  entityName: string;
  rows: ReportSubjectBreakdownRow[];
  showProgram: boolean;
  y: number;
}): number {
  let y = opts.y;
  if (y > 250) { doc.addPage(); y = 18; }
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text(opts.entityName, MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 4;

  const head = opts.showProgram
    ? ["Subject", "Curriculum", "Program", "Sessions", "Hours"]
    : ["Subject", "Curriculum", "Sessions", "Hours"];

  autoTable(doc, {
    startY: y,
    theme: "striped",
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [head],
    headStyles: { fillColor: SKY as [number, number, number], textColor: 255, fontSize: 8.5 },
    body: opts.rows.map((r) => {
      const row = [subjectLabel(r.subjectName, r.subjectLevel), r.curriculumName ?? "—"];
      if (opts.showProgram) row.push(r.programTypeName ?? "—");
      row.push(String(r.sessions), `${formatHours(r.hours)} hrs`);
      return row;
    }),
    bodyStyles: { fontSize: 8 },
    columnStyles: opts.showProgram
      ? { 3: { halign: "center" }, 4: { halign: "right", fontStyle: "bold" } }
      : { 2: { halign: "center" }, 3: { halign: "right", fontStyle: "bold" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6;
}

// Builds the combined "full data" download for the admin Reports > Reports
// tab: one invoice-branded PDF with the same monthly totals, the teacher
// hours table, the student hours (monthly revenue) table, and — when
// supplied — a subject/curriculum breakdown per teacher and per student, so
// it can be checked in full before locking a month, or re-downloaded from
// an already-locked report snapshot afterwards.
export function buildFullMonthlyReportPdf(opts: {
  year: number;
  month: number;
  totalHours: number;
  totalSessions: number;
  uniqueStudents: number;
  noShowCount: number;
  teacherStats: MonthlyRevenueStatRow[];
  studentStats: MonthlyRevenueStatRow[];
  subjectTotals?: ReportSubjectBreakdownRow[];
  teacherBreakdowns?: ReportTeacherBreakdown[];
  studentBreakdowns?: ReportStudentBreakdown[];
  locked?: boolean;
}) {
  const { year, month, totalHours, totalSessions, uniqueStudents, noShowCount, teacherStats, studentStats, subjectTotals, teacherBreakdowns, studentBreakdowns, locked } = opts;
  const monthLabel = new Date(year, month - 1).toLocaleString("en-GB", { month: "long", year: "numeric" });

  const doc = new jsPDF();
  let y = drawHeader(doc, {
    title: "Monthly Report",
    subtitle: `${monthLabel}${locked ? " · Locked" : ""}`,
  });

  // Summary banner
  doc.setFillColor(...SKY_LIGHT);
  doc.roundedRect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 16, 2, 2, "F");
  const summary: [string, string][] = [
    ["Total Hours", `${formatHours(totalHours)} hrs`],
    ["Sessions", String(totalSessions)],
    ["Active Students", String(uniqueStudents)],
    ["No-shows", String(noShowCount)],
  ];
  const colWidth = (PAGE_WIDTH - MARGIN_X * 2) / summary.length;
  summary.forEach(([label, value], i) => {
    const cx = MARGIN_X + colWidth * i + colWidth / 2;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY_DARK);
    doc.text(value, cx, y + 7, { align: "center" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GREY);
    doc.text(label, cx, y + 12.5, { align: "center" });
  });
  doc.setTextColor(0, 0, 0);
  y += 22;

  if (subjectTotals && subjectTotals.length > 0) {
    doc.setFontSize(11.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY_DARK);
    doc.text("Hours by Subject", MARGIN_X, y);
    doc.setTextColor(0, 0, 0);
    y += 5;

    const subjectTotalHours = subjectTotals.reduce((sum, s) => sum + s.hours, 0);
    const subjectTotalSessions = subjectTotals.reduce((sum, s) => sum + s.sessions, 0);
    autoTable(doc, {
      startY: y,
      theme: "striped",
      margin: { left: MARGIN_X, right: MARGIN_X },
      head: [["Subject", "Curriculum", "Sessions", "Hours"]],
      headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 9.5 },
      body: subjectTotals.map((s) => [subjectLabel(s.subjectName, s.subjectLevel), s.curriculumName ?? "—", String(s.sessions), `${formatHours(s.hours)} hrs`]),
      foot: [["Total", "", String(subjectTotalSessions), `${formatHours(subjectTotalHours)} hrs`]],
      footStyles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold" },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 2: { halign: "center" }, 3: { halign: "right", fontStyle: "bold" } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  if (y > 245) { doc.addPage(); y = 18; }
  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Teacher Hours", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "striped",
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Teacher", "Sessions", "Hours"]],
    headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 9.5 },
    body: teacherStats.length > 0
      ? teacherStats.map((s) => [s.teacherName ?? "—", String(s.sessions), `${formatHours(s.hours)} hrs`])
      : [["No sessions logged this month.", "", ""]],
    foot: teacherStats.length > 0 ? [["Total", String(totalSessions), `${formatHours(totalHours)} hrs`]] : undefined,
    footStyles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold" },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: "center" }, 2: { halign: "right", fontStyle: "bold" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  if (y > 245) { doc.addPage(); y = 18; }
  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Student Hours Breakdown (Monthly Revenue)", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "striped",
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Student", "Sessions", "Hours"]],
    headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 9.5 },
    body: studentStats.length > 0
      ? studentStats.map((s) => [s.studentName ?? "—", String(s.sessions), `${formatHours(s.hours)} hrs`])
      : [["No sessions logged this month.", "", ""]],
    foot: studentStats.length > 0 ? [["Total", String(totalSessions), `${formatHours(totalHours)} hrs`]] : undefined,
    footStyles: { fillColor: SKY_LIGHT as [number, number, number], textColor: NAVY_DARK as [number, number, number], fontStyle: "bold" },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: "center" }, 2: { halign: "right", fontStyle: "bold" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  if (teacherBreakdowns && teacherBreakdowns.length > 0) {
    if (y > 245) { doc.addPage(); y = 18; }
    doc.setFontSize(11.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY_DARK);
    doc.text("Teacher Hours by Subject & Curriculum", MARGIN_X, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
    for (const t of teacherBreakdowns) {
      y = drawReportBreakdownTable(doc, { title: "Teacher Hours by Subject & Curriculum", entityName: t.teacherName, rows: t.rows, showProgram: true, y });
    }
  }

  if (studentBreakdowns && studentBreakdowns.length > 0) {
    if (y > 245) { doc.addPage(); y = 18; }
    doc.setFontSize(11.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY_DARK);
    doc.text("Student Hours by Subject & Curriculum", MARGIN_X, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
    for (const s of studentBreakdowns) {
      y = drawReportBreakdownTable(doc, { title: "Student Hours by Subject & Curriculum", entityName: s.studentName, rows: s.rows, showProgram: false, y });
    }
  }

  drawFooter(doc);
  doc.save(`monthly-report_${year}-${String(month).padStart(2, "0")}${locked ? "_locked" : ""}.pdf`);
}

// ── Teacher invoice (hours report) ───────────────────────────────────────────

export type TeacherInvoiceInfo = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  subjectsTaught: string[];
};

export type TeacherHoursBreakdownRow = {
  subjectName: string;
  subjectLevel: string | null;
  curriculumName: string | null;
  programTypeName: string | null;
  sessions: number;
  hours: number;
};

export type TeacherNoShowRow = {
  date: string;
  studentName: string;
  subjectName: string | null;
  subjectLevel: string | null;
  noShowLabel: string;
};

function drawTeacherDetails(doc: jsPDF, teacher: TeacherInvoiceInfo, y: number): number {
  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Teacher Details", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  // Subjects render as one bullet per line (not a joined paragraph) so a
  // teacher with a dozen+ subjects still reads as a scannable list.
  const subjectsCell = teacher.subjectsTaught.length > 0
    ? teacher.subjectsTaught.map((s) => `•  ${s}`).join("\n")
    : "—";

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 9.5, cellPadding: 1.2, valign: "top" },
    columnStyles: { 0: { fontStyle: "bold", textColor: NAVY_DARK as [number, number, number], cellWidth: 38 } },
    body: [
      ["Teacher Name", teacher.name],
      ["Email", teacher.email ?? "—"],
      ["Phone Number", teacher.phone ?? "—"],
      ["Country", teacher.country ?? "—"],
      ["Subjects Taught", subjectsCell],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6;
}

// Draws the shared body of a teacher's hours report — total-hours banner,
// sessions/no-show summary, hours-by-subject-and-program table, and a
// no-show table. Shared by the single-teacher invoice and the all-teachers
// report so both stay in sync.
function drawTeacherReportBody(doc: jsPDF, opts: {
  totalHours: number;
  totalSessions: number;
  breakdown: TeacherHoursBreakdownRow[];
  noShows: TeacherNoShowRow[];
  y: number;
}): number {
  const { totalHours, totalSessions, breakdown, noShows } = opts;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  let y = opts.y;

  doc.setFillColor(...SKY_LIGHT);
  doc.roundedRect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 12, 2, 2, "F");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Total Hours Delivered", MARGIN_X + 4, y + 8);
  doc.setFontSize(12);
  doc.text(`${formatHours(totalHours)} hrs`, PAGE_WIDTH - MARGIN_X - 4, y + 8, { align: "right" });
  doc.setTextColor(0, 0, 0);
  y += 18;

  autoTable(doc, {
    startY: y,
    theme: "plain",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 9.5, cellPadding: 1.2 },
    body: [[
      { content: `Sessions Completed: ${totalSessions}`, styles: { fontStyle: "bold", textColor: NAVY_DARK as [number, number, number] } },
      { content: `No-shows: ${noShows.length}`, styles: { fontStyle: "bold", textColor: (noShows.length > 0 ? [180, 60, 40] : NAVY_DARK) as [number, number, number], halign: "right" as const } },
    ]],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Hours by Subject & Program", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "striped",
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Subject", "Curriculum", "Program", "Sessions", "Hours"]],
    headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 9.5 },
    body: breakdown.length > 0
      ? breakdown.map((b) => [
          subjectLabel(b.subjectName, b.subjectLevel),
          b.curriculumName ?? "—",
          b.programTypeName ?? "—",
          String(b.sessions),
          `${formatHours(b.hours)} hrs`,
        ])
      : [["No sessions logged this period.", "", "", "", ""]],
    bodyStyles: { fontSize: 9 },
    columnStyles: { 3: { halign: "center" }, 4: { halign: "right", fontStyle: "bold" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  if (y > 245) { doc.addPage(); y = 18; }
  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("No-Show Sessions", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "striped",
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Date", "Student", "Subject", "Type"]],
    headStyles: { fillColor: [180, 60, 40], textColor: 255, fontSize: 9.5 },
    body: noShows.length > 0
      ? noShows.map((n) => [
          fmtDate(n.date),
          n.studentName,
          n.subjectName ? subjectLabel(n.subjectName, n.subjectLevel) : "—",
          n.noShowLabel,
        ])
      : [["No no-show sessions this period.", "", "", ""]],
    bodyStyles: { fontSize: 9 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 6;
}

// Builds an invoice-style PDF report for one teacher's hours over a period:
// their details, total hours/sessions/no-shows, an hours-by-subject-and-program
// breakdown, and a table of no-show sessions. A separate "Download Session Logs"
// export (see AdminReportsPage) covers the raw per-session data.
export function buildTeacherInvoicePdf(opts: {
  teacher: TeacherInvoiceInfo;
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  totalSessions: number;
  breakdown: TeacherHoursBreakdownRow[];
  noShows: TeacherNoShowRow[];
}) {
  const { teacher, periodStart, periodEnd, totalHours, totalSessions, breakdown, noShows } = opts;
  const doc = new jsPDF();
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  let y = drawHeader(doc, {
    title: "Teacher Report",
    subtitle: `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`,
  });

  y = drawTeacherDetails(doc, teacher, y);
  drawTeacherReportBody(doc, { totalHours, totalSessions, breakdown, noShows, y });

  drawFooter(doc);
  doc.save(`teacher-report_${teacher.id}_${periodStart}_${periodEnd}.pdf`);
}

// ── All-teachers report (org-wide) ───────────────────────────────────────────

export type AllTeachersReportTeacher = TeacherInvoiceInfo & {
  totalHours: number;
  totalSessions: number;
  breakdown: TeacherHoursBreakdownRow[];
  noShows: TeacherNoShowRow[];
};

// Builds one PDF covering every teacher for a period: an org-wide summary
// (total hours/sessions/no-shows across all teachers) followed by a
// per-teacher page with the same details/breakdown/no-show layout as
// buildTeacherInvoicePdf, so it reads as a bundle of individual reports.
export function buildAllTeachersReportPdf(opts: {
  periodStart: string;
  periodEnd: string;
  teachers: AllTeachersReportTeacher[];
}) {
  const { periodStart, periodEnd, teachers } = opts;
  const doc = new jsPDF();
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const totalHours = teachers.reduce((sum, t) => sum + t.totalHours, 0);
  const totalSessions = teachers.reduce((sum, t) => sum + t.totalSessions, 0);
  const totalNoShows = teachers.reduce((sum, t) => sum + t.noShows.length, 0);
  const sortedByHours = [...teachers].sort((a, b) => b.totalHours - a.totalHours);

  let y = drawHeader(doc, {
    title: "All Teachers Report",
    subtitle: `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`,
  });

  doc.setFillColor(...SKY_LIGHT);
  doc.roundedRect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 12, 2, 2, "F");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Total Hours Delivered — All Teachers", MARGIN_X + 4, y + 8);
  doc.setFontSize(12);
  doc.text(`${formatHours(totalHours)} hrs`, PAGE_WIDTH - MARGIN_X - 4, y + 8, { align: "right" });
  doc.setTextColor(0, 0, 0);
  y += 18;

  autoTable(doc, {
    startY: y,
    theme: "plain",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 9.5, cellPadding: 1.2 },
    body: [[
      { content: `Teachers: ${teachers.length}`, styles: { fontStyle: "bold", textColor: NAVY_DARK as [number, number, number] } },
      { content: `Sessions: ${totalSessions}`, styles: { fontStyle: "bold", textColor: NAVY_DARK as [number, number, number], halign: "center" as const } },
      { content: `No-shows: ${totalNoShows}`, styles: { fontStyle: "bold", textColor: (totalNoShows > 0 ? [180, 60, 40] : NAVY_DARK) as [number, number, number], halign: "right" as const } },
    ]],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY_DARK);
  doc.text("Teacher Summary", MARGIN_X, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  autoTable(doc, {
    startY: y,
    theme: "striped",
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Teacher", "Sessions", "Hours", "No-shows"]],
    headStyles: { fillColor: NAVY as [number, number, number], textColor: 255, fontSize: 9.5 },
    body: sortedByHours.length > 0
      ? sortedByHours.map((t) => [t.name, String(t.totalSessions), `${formatHours(t.totalHours)} hrs`, String(t.noShows.length)])
      : [["No teacher activity this period.", "", "", ""]],
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: "center" }, 2: { halign: "right", fontStyle: "bold" }, 3: { halign: "center" } },
  });

  for (const teacher of sortedByHours) {
    doc.addPage();
    let ty = 18;

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY_DARK);
    doc.text(teacher.name, MARGIN_X, ty);
    doc.setTextColor(0, 0, 0);
    ty += 7;

    ty = drawTeacherDetails(doc, teacher, ty);
    drawTeacherReportBody(doc, {
      totalHours: teacher.totalHours,
      totalSessions: teacher.totalSessions,
      breakdown: teacher.breakdown,
      noShows: teacher.noShows,
      y: ty,
    });
  }

  drawFooter(doc);
  doc.save(`all-teachers-report_${periodStart}_${periodEnd}.pdf`);
}

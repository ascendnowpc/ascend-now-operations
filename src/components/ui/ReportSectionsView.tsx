import { formatHours } from "../../utils/formatHours";
import { subjectLabel } from "../../utils/subjectLabel";
import { sessionCountLabel } from "../../utils/noShow";
import { groupSectionsIntoBlocks, type ReportSection, type ReportTeacherRow } from "../../utils/buildInvoicePdf";

// One self-contained table per section (a standalone course type, or a single
// pool of a Foundation Program / All-In-One bundle). Bundle pools are grouped
// under a bundle header that shows their combined total, but each pool is its
// own table with clear spacing between them. Shared by the admin and
// teacher/PC invoice lists and the admin Reports preview so every report
// surface reads identically and professionally.
export function ReportSectionsView({ sections }: { sections: ReportSection[] }) {
  const blocks = groupSectionsIntoBlocks(sections);
  if (blocks.length === 0) {
    return <p className="text-sm text-navy-300 italic">No sessions in this report.</p>;
  }
  return (
    <div className="space-y-8">
      {blocks.map((block, bi) => {
        const isBundle = block.bundleName != null;
        return (
          <div key={bi}>
            {isBundle && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-navy-800 px-4 py-2.5 mb-3">
                <span className="text-white font-bold tracking-tight">{block.title}</span>
                <span className="text-xs font-medium text-sky-200 whitespace-nowrap">
                  {sessionCountLabel(block.session_count, block.noShowCount)} · {formatHours(block.hours)} hrs combined
                </span>
              </div>
            )}
            <div className="space-y-4">
              {block.sections.map((sec) => (
                <SectionTables
                  key={sec.key}
                  title={isBundle && sec.sectionName !== sec.courseTypeName ? sec.sectionName : sec.courseTypeName}
                  subtitle={isBundle && sec.sectionName !== sec.courseTypeName ? sec.courseTypeName : null}
                  section={sec}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Sessions/hours cell used in both the subject and teacher tables — renders
// the no-show portion (if any) in amber so a reader can see at a glance which
// rows include hours deducted for a no-show rather than a completed session,
// without having to cross-reference a separate list.
function SessionCountCell({ sessionCount, noShowCount }: { sessionCount: number; noShowCount: number }) {
  if (noShowCount === 0) {
    return <span className="text-navy-600 tabular-nums">{sessionCountLabel(sessionCount, noShowCount)}</span>;
  }
  return (
    <span className="tabular-nums">
      {sessionCount > 0 && <span className="text-navy-600">{sessionCount} session{sessionCount !== 1 ? "s" : ""} + </span>}
      <span className="text-amber-600 font-semibold">{noShowCount} no-show{noShowCount !== 1 ? "s" : ""}</span>
    </span>
  );
}

// Renders one section as two clearly labeled, self-contained tables — one
// showing hours by subject/program, one showing sessions & hours by teacher
// — rather than nesting the teacher breakdown inside the subject table.
// Splitting them out (instead of one table mixing two different row grains
// via indentation) mirrors how the admin's monthly report already separates
// "Hours by Subject" / "Teacher Hours" / "Student Hours" into distinct
// labeled tables (see AdminReportsPage.tsx's ReportCard / buildFullMonthlyReportPdf).
function SectionTables({
  title, subtitle, section,
}: {
  title: string;
  subtitle: string | null;
  section: ReportSection;
}) {
  return (
    <div className="rounded-xl border border-navy-100 overflow-hidden shadow-sm bg-white">
      {/* Section header — title + its own total */}
      <div className="flex items-center justify-between gap-3 bg-navy-700 px-4 py-2.5">
        <span className="text-white font-semibold text-sm">
          {title}
          {subtitle && <span className="ml-1.5 text-xs font-normal text-sky-200">· {subtitle}</span>}
        </span>
        <span className="text-xs font-medium text-sky-200 whitespace-nowrap">
          {sessionCountLabel(section.session_count, section.noShowCount)} · {formatHours(section.hours)} hrs
        </span>
      </div>

      {/* Table 1: Hours by Subject */}
      <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy-400 bg-navy-50/60">
        Hours by Subject
      </p>
      <div className="grid grid-cols-[1fr_9rem_6rem] items-center px-4 py-2 bg-navy-50 border-y border-navy-100 text-[11px] font-semibold uppercase tracking-wide text-navy-400">
        <span>Program / Subject</span>
        <span className="text-center">Sessions</span>
        <span className="text-right">Hours</span>
      </div>
      {section.subjects.map((subj, si) => (
        <div key={si} className="grid grid-cols-[1fr_9rem_6rem] items-center px-4 py-2.5 border-b border-navy-50">
          <span className="font-medium text-navy-700 text-sm">
            {subjectLabel(subj.subjectName, subj.subjectLevel)}
            {subj.curriculumName && <span className="ml-1.5 text-xs font-normal text-navy-400">· {subj.curriculumName}</span>}
          </span>
          <span className="text-center text-sm"><SessionCountCell sessionCount={subj.session_count} noShowCount={subj.noShowCount} /></span>
          <span className="text-right text-sm font-semibold text-navy-700 tabular-nums">{formatHours(subj.hours)} hrs</span>
        </div>
      ))}

      {/* Table 2: Sessions & Hours by Teacher (aggregated across every
          subject in this section, not nested under each subject row) */}
      {section.teachers.length > 0 && (
        <>
          <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy-400 bg-navy-50/60 border-t border-navy-100">
            Sessions &amp; Hours by Teacher
          </p>
          <div className="grid grid-cols-[1fr_9rem_6rem] items-center px-4 py-2 bg-navy-50 border-y border-navy-100 text-[11px] font-semibold uppercase tracking-wide text-navy-400">
            <span>Teacher</span>
            <span className="text-center">Sessions</span>
            <span className="text-right">Hours</span>
          </div>
          {section.teachers.map((t: ReportTeacherRow, ti) => (
            <div key={ti} className="grid grid-cols-[1fr_9rem_6rem] items-center px-4 py-2 border-b border-navy-50 last:border-b-0">
              <span className="text-navy-700 text-sm">{t.teacherName}</span>
              <span className="text-center text-sm"><SessionCountCell sessionCount={t.session_count} noShowCount={t.noShowCount} /></span>
              <span className="text-right text-sm font-semibold text-navy-700 tabular-nums">{formatHours(t.hours)} hrs</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

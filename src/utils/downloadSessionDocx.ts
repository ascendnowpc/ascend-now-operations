import { Document, Paragraph, TextRun, Packer } from "docx";
import type { SessionLog } from "../types/database";

const NO_SHOW_LABELS: Record<string, string> = {
  no_show_1: "No Show 1",
  no_show_2: "No Show 2",
  no_show_plus: "No Show +",
};

function field(label: string, value: string): Paragraph[] {
  const lines = (value || "—").split("\n");
  return [
    new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 20, color: "334155" })],
      spacing: { before: 160 },
    }),
    new Paragraph({
      children: lines.flatMap((line, i) =>
        i === 0
          ? [new TextRun({ text: line, size: 20 })]
          : [new TextRun({ text: line, size: 20, break: 1 })]
      ),
    }),
  ];
}

export async function downloadSessionDocx(
  log: SessionLog,
  opts: {
    studentDisplay: string;
    teacherName: string;
    coordinatorName: string;
    programTypeName: string;
    subjectName: string;
    curriculumName?: string;
  }
) {
  const sessionDate = new Date(log.session_date).toLocaleDateString("en-GB", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const noShow = log.no_show_type ? (NO_SHOW_LABELS[log.no_show_type] ?? log.no_show_type) : "No";
  const independence = log.independent_work?.[0]?.replace(/_/g, " ") ?? "—";
  const engagement = log.engagement_rating ? log.engagement_rating.charAt(0).toUpperCase() + log.engagement_rating.slice(1) : "—";

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [new TextRun({ text: "Session Log", bold: true, size: 36, color: "1e3a5f" })],
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`, size: 18, color: "94a3b8" })],
          spacing: { after: 240 },
        }),

        ...field("Student", opts.studentDisplay),
        ...field("Session Date", sessionDate),
        ...field("No Show", noShow),
        ...field("Teacher", opts.teacherName),
        ...field("Performance Coach", opts.coordinatorName),
        ...field("Program Type", opts.programTypeName),
        ...(opts.curriculumName ? field("Curriculum", opts.curriculumName) : []),
        ...field("Subject", opts.subjectName),
        ...field("Topic", log.topic ?? "—"),
        ...field("Duration (hrs)", log.session_duration_hrs != null ? String(log.session_duration_hrs) : "—"),
        ...field("Independent Work Completed", independence),
        ...field("Engagement Rating", engagement),
        ...field("Performance Feedback", log.performance_feedback ?? "—"),
        ...field("Flagged for Performance Coach", log.flag_for_coach ? (log.flag_category ?? "Yes") : "No"),
        ...(log.flag_for_coach ? field("Flag Comments", log.flag_comments ?? "—") : []),
        ...field("Video Link", log.video_link ?? "—"),
        ...(log.fathom_summary ? field("Fathom Transcript", log.fathom_summary) : []),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `session-${log.id}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

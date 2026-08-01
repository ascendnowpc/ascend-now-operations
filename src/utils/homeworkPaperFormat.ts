import type { GeneratedPaper } from "../types/database";

// Pure labelling/format helpers shared by the PDF and DOCX homework paper
// exporters (see exportHomeworkPaper). Kept out of that module so they can be
// unit-tested without jsPDF/docx — both exporters must agree on the sheet
// title and download filename, so these are the single source of both.

export type HomeworkSheet = "question" | "answer";

export function marksLabel(n: number) {
  return `${n} ${n === 1 ? "mark" : "marks"}`;
}

export function sheetTitle(sheet: HomeworkSheet) {
  return sheet === "answer" ? "Homework — Answer Sheet" : "Homework — Question Sheet";
}

export function fileBase(paper: GeneratedPaper, sheet: HomeworkSheet) {
  return `homework_${paper.student_id}_${sheet}-sheet`;
}

// Figures are cropped as PNG by parse-homework-paper, but this reads the
// actual data: URL mime type rather than assuming a format — jsPDF's
// addImage needs an explicit format matching the real bytes, and guessing
// wrong silently corrupts the embedded image instead of erroring.
export function dataUrlImageFormat(dataUrl: string): "JPEG" | "PNG" | "WEBP" | null {
  const m = /^data:image\/(\w+);base64,/.exec(dataUrl);
  if (!m) return null;
  const subtype = m[1].toLowerCase();
  if (subtype === "jpeg" || subtype === "jpg") return "JPEG";
  if (subtype === "png") return "PNG";
  if (subtype === "webp") return "WEBP";
  return null;
}

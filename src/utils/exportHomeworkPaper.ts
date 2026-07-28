import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Document, Paragraph, TextRun, Packer, Table, TableRow, TableCell, WidthType, ImageRun } from "docx";
import { ASCEND_LOGO_PNG_BASE64 } from "../assets/ascendLogoBase64";
import { stripOptionLabel } from "./homeworkGrading";
import { parseMarkdownBlocks, type MarkdownBlock } from "./markdownBlocks";
import type { GeneratedPaper, GeneratedQuestion, QuestionFigure } from "../types/database";

// Phase 8 — export a generated paper's questions_json to PDF / DOCX, as either
// the teacher Answer Sheet (prompts + answers + mark scheme) or the Student
// Question Sheet (prompts only, with space to write). Reuses the repo's existing
// jspdf / jspdf-autotable / docx tooling — no new document library. Download only.

export type HomeworkSheet = "question" | "answer";

export interface HomeworkExportMeta {
  studentDisplay?: string;
  subjectName?: string | null;
  curriculumName?: string | null;
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

function marksLabel(n: number) {
  return `${n} ${n === 1 ? "mark" : "marks"}`;
}

function sheetTitle(sheet: HomeworkSheet) {
  return sheet === "answer" ? "Homework — Answer Sheet" : "Homework — Question Sheet";
}

function fileBase(paper: GeneratedPaper, sheet: HomeworkSheet) {
  return `homework_${paper.student_id}_${sheet}-sheet`;
}

// Figures are stored as data: URLs (see QuestionFigure) — loading them through
// an <img> is the simplest way to recover their natural pixel size, which both
// jsPDF's addImage and docx's ImageRun `transformation` need up front to avoid
// stretching the image out of its aspect ratio.
// Figures are cropped as PNG by parse-homework-paper, but this reads the
// actual data: URL mime type rather than assuming a format — jsPDF's
// addImage needs an explicit format matching the real bytes, and guessing
// wrong silently corrupts the embedded image instead of erroring.
function dataUrlImageFormat(dataUrl: string): "JPEG" | "PNG" | "WEBP" | null {
  const m = /^data:image\/(\w+);base64,/.exec(dataUrl);
  if (!m) return null;
  const subtype = m[1].toLowerCase();
  if (subtype === "jpeg" || subtype === "jpg") return "JPEG";
  if (subtype === "png") return "PNG";
  if (subtype === "webp") return "WEBP";
  return null;
}

function loadImageSize(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function collectFigureSizes(
  questions: GeneratedQuestion[],
): Promise<Map<string, { width: number; height: number }>> {
  const sizes = new Map<string, { width: number; height: number }>();
  const urls = new Set<string>();
  for (const q of questions) for (const fig of q.figures ?? []) urls.add(fig.data_url);
  await Promise.all(
    [...urls].map(async (url) => {
      const size = await loadImageSize(url);
      if (size) sizes.set(url, size);
    }),
  );
  return sizes;
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const NAVY = [36, 50, 107] as const;
const SKY = [64, 176, 229] as const;
const GREY = [110, 120, 150] as const;
const INK = [24, 30, 52] as const;
const BORDER = [210, 216, 228] as const;
const MARGIN_X = 14;
const PAGE_WIDTH = 210; // A4 portrait, mm
const CONTENT_W = PAGE_WIDTH - MARGIN_X * 2;

function pageH(doc: jsPDF) {
  return doc.internal.pageSize.getHeight();
}

// Ensures `need` mm of vertical space remains, adding a page (returning the new
// top y) when it doesn't.
function ensure(doc: jsPDF, y: number, need: number): number {
  if (y + need > pageH(doc) - 16) {
    doc.addPage();
    return 18;
  }
  return y;
}

function drawText(doc: jsPDF, text: string, x: number, y: number, w: number, lh = 5): number {
  const lines = doc.splitTextToSize(text || "—", w) as string[];
  for (const line of lines) {
    y = ensure(doc, y, lh);
    doc.text(line, x, y);
    y += lh;
  }
  return y;
}

function drawPdfHeader(doc: jsPDF, title: string, subtitle: string): number {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_WIDTH, 28, "F");
  doc.setFillColor(...SKY);
  doc.rect(0, 28, PAGE_WIDTH, 1.2, "F");
  try {
    const w = 38;
    const h = w * (86 / 338);
    doc.addImage(ASCEND_LOGO_PNG_BASE64, "PNG", MARGIN_X, (28 - h) / 2, w, h);
  } catch {
    // Logo failed to decode — text-only header.
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, PAGE_WIDTH - MARGIN_X, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(subtitle, PAGE_WIDTH - MARGIN_X, 19.5, { align: "right" });
  doc.setTextColor(0, 0, 0);
  return 36;
}

function drawPdfFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const h = pageH(doc);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text("Ascend Now", MARGIN_X, h - 8);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_WIDTH - MARGIN_X, h - 8, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }
}

// Renders a Markdown prompt as jsPDF content: a "table" block becomes a real
// jspdf-autotable grid (so a transcribed data table reads as a table, not
// run-together text); everything else draws as plain wrapped text exactly as
// before.
function drawMarkdownBlocksPdf(doc: jsPDF, markdown: string, x: number, y: number, w: number): number {
  const blocks: MarkdownBlock[] = parseMarkdownBlocks(markdown);
  for (const block of blocks) {
    if (block.type === "paragraph") {
      if (!block.text) {
        y += 2;
        continue;
      }
      for (const line of block.text.split("\n")) {
        y = drawText(doc, line, x, y, w);
      }
    } else {
      y = ensure(doc, y, 14);
      autoTable(doc, {
        startY: y,
        margin: { left: x, right: PAGE_WIDTH - x - w },
        theme: "grid",
        styles: { fontSize: 8.5, cellPadding: 1.6, textColor: INK as unknown as [number, number, number] },
        headStyles: { fillColor: NAVY as unknown as [number, number, number], textColor: 255, fontStyle: "bold" },
        head: [block.header],
        body: block.rows,
      });
      // jspdf-autotable augments the doc instance with lastAutoTable at runtime
      // (no first-class type for it) — same pattern already used in buildInvoicePdf.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 3;
    }
  }
  return y;
}

const FIGURE_MAX_W_MM = 90;
const FIGURE_MAX_H_MM = 70;

// Draws every figure attached to a question — the exact image cropped from
// the original uploaded paper — sized to fit a print-reasonable box without
// distorting its aspect ratio (falls back to a fixed box if the size wasn't
// preloaded, e.g. the image failed to decode).
function drawFiguresPdf(
  doc: jsPDF,
  figures: QuestionFigure[] | undefined,
  y: number,
  figureSizes: Map<string, { width: number; height: number }>,
): number {
  if (!figures || figures.length === 0) return y;
  for (const fig of figures) {
    const size = figureSizes.get(fig.data_url);
    let w = FIGURE_MAX_W_MM;
    let h = FIGURE_MAX_H_MM * 0.6;
    if (size && size.width > 0 && size.height > 0) {
      const aspect = size.width / size.height;
      if (aspect >= FIGURE_MAX_W_MM / FIGURE_MAX_H_MM) {
        w = FIGURE_MAX_W_MM;
        h = w / aspect;
      } else {
        h = FIGURE_MAX_H_MM;
        w = h * aspect;
      }
    }
    y = ensure(doc, y, h + 4);
    const format = dataUrlImageFormat(fig.data_url);
    if (format) {
      try {
        doc.addImage(fig.data_url, format, MARGIN_X + 6, y, w, h);
      } catch {
        // A figure jsPDF couldn't decode is skipped rather than failing the export.
      }
    }
    y += h + 4;
  }
  return y;
}

function drawQuestionPdf(
  doc: jsPDF,
  q: GeneratedQuestion,
  num: number,
  sheet: HomeworkSheet,
  y: number,
  figureSizes: Map<string, { width: number; height: number }>,
): number {
  y = ensure(doc, y, 16);

  // Q-number + type + marks line.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...NAVY);
  doc.text(`Q${num}`, MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text(`${q.question_type.replace(/_/g, " ")} · ${marksLabel(q.marks)}`, MARGIN_X + 13, y);
  doc.setTextColor(0, 0, 0);
  y += 5.5;

  // Prompt — parsed as Markdown blocks so a transcribed table renders as a
  // real table, not run-together text.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  y = drawMarkdownBlocksPdf(doc, q.prompt, MARGIN_X, y, CONTENT_W);
  doc.setTextColor(0, 0, 0);
  y += 1.5;

  // Figures (parsed papers) — the exact image cropped from the original paper.
  y = drawFiguresPdf(doc, q.figures, y, figureSizes);

  if (q.question_type === "mcq" || q.question_type === "true_false") {
    doc.setFontSize(9.5);
    (q.options ?? []).forEach((opt, i) => {
      const correct = sheet === "answer" && q.correct_option === i;
      doc.setFont("helvetica", correct ? "bold" : "normal");
      const c = correct ? NAVY : INK;
      doc.setTextColor(c[0], c[1], c[2]);
      const label = `${LETTERS[i] ?? i + 1}.  ${stripOptionLabel(opt)}${correct ? "   (correct)" : ""}`;
      y = drawText(doc, label, MARGIN_X + 6, y, CONTENT_W - 6, 4.8);
    });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
  } else if (q.question_type === "fill_blank") {
    doc.setFontSize(9.5);
    if (sheet === "answer") {
      const also = (q.acceptable_answers ?? []).filter(Boolean);
      doc.setTextColor(...INK);
      y = drawText(
        doc,
        `Answer: ${q.expected_answer ?? "—"}${also.length ? `  (also: ${also.join(", ")})` : ""}`,
        MARGIN_X + 6,
        y,
        CONTENT_W - 6,
      );
      doc.setTextColor(0, 0, 0);
    } else {
      y = ensure(doc, y, 6);
      doc.setTextColor(...GREY);
      doc.text("Answer:", MARGIN_X + 6, y);
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.2);
      doc.line(MARGIN_X + 22, y, PAGE_WIDTH - MARGIN_X, y);
      doc.setTextColor(0, 0, 0);
      y += 7;
    }
  } else if (sheet === "answer") {
    // Mark scheme (answer sheet).
    y = ensure(doc, y, 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY);
    doc.text("Mark scheme", MARGIN_X + 6, y);
    doc.setTextColor(0, 0, 0);
    y += 4.6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    (q.mark_scheme ?? []).forEach((p) => {
      y = drawText(doc, `•  ${p.point}  (${marksLabel(p.marks)})`, MARGIN_X + 6, y, CONTENT_W - 6, 4.6);
    });
  } else {
    // Mark-scheme type (question sheet) — writing space sized loosely to marks.
    const boxH = Math.max(20, Math.min(70, 12 + q.marks * 5));
    y = ensure(doc, y, boxH + 2);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.roundedRect(MARGIN_X + 6, y, CONTENT_W - 6, boxH, 1.5, 1.5);
    y += boxH + 2;
  }

  return y + 5;
}

export async function exportHomeworkPaperPdf(
  paper: GeneratedPaper,
  sheet: HomeworkSheet,
  meta: HomeworkExportMeta = {},
) {
  const content = paper.questions_json;
  if (!content) return;
  const figureSizes = await collectFigureSizes(content.questions);
  const doc = new jsPDF();

  const subtitle = [meta.studentDisplay, meta.subjectName, meta.curriculumName]
    .filter(Boolean)
    .join(" · ");
  let y = drawPdfHeader(doc, sheetTitle(sheet), subtitle || `Student ${paper.student_id}`);

  // Meta strip.
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(
    `${paper.difficulty} · ${content.total_questions} questions · ${content.total_marks} marks`,
    MARGIN_X,
    y,
  );
  doc.setTextColor(0, 0, 0);
  y += 7;

  content.questions.forEach((q, i) => {
    y = drawQuestionPdf(doc, q, i + 1, sheet, y, figureSizes);
  });

  drawPdfFooter(doc);
  doc.save(`${fileBase(paper, sheet)}.pdf`);
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

// Renders a Markdown prompt as docx content: a "table" block becomes a real
// docx Table (so a transcribed data table reads as a table, not run-together
// text); everything else draws as plain paragraphs, one per original line,
// exactly as before Markdown support was added.
function docxMarkdownBlocks(markdown: string): (Paragraph | Table)[] {
  const blocks: MarkdownBlock[] = parseMarkdownBlocks(markdown);
  const out: (Paragraph | Table)[] = [];
  let firstParagraph = true;
  for (const block of blocks) {
    if (block.type === "paragraph") {
      if (!block.text) continue;
      block.text.split("\n").forEach((line) => {
        out.push(
          new Paragraph({
            spacing: firstParagraph ? { after: 40 } : undefined,
            children: [new TextRun({ text: line, size: 20 })],
          }),
        );
        firstParagraph = false;
      });
    } else {
      out.push(docxTable(block));
      firstParagraph = false;
    }
  }
  return out;
}

function docxTable(block: Extract<MarkdownBlock, { type: "table" }>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: block.header.map(
          (cell) =>
            new TableCell({
              shading: { fill: "24326B" },
              children: [
                new Paragraph({ children: [new TextRun({ text: cell, bold: true, size: 18, color: "FFFFFF" })] }),
              ],
            }),
        ),
      }),
      ...block.rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: cell, size: 18 })] })],
                }),
            ),
          }),
      ),
    ],
  });
}

const DOCX_FIGURE_MAX_W = 420;
const DOCX_FIGURE_MAX_H = 320;

// Embeds every figure attached to a question as an inline image, sized to fit
// a print-reasonable box without distorting its aspect ratio.
async function docxFigures(figures: QuestionFigure[] | undefined): Promise<Paragraph[]> {
  if (!figures || figures.length === 0) return [];
  const out: Paragraph[] = [];
  for (const fig of figures) {
    const match = /^data:image\/(\w+);base64,(.+)$/.exec(fig.data_url);
    if (!match) continue;
    // docx's ImageRun needs an explicit type matching the real bytes (figures
    // are cropped as PNG by parse-homework-paper, but this reads the actual
    // mime subtype rather than assuming, in case that ever changes).
    const subtype = match[1].toLowerCase();
    const docxType = subtype === "png" ? "png" : subtype === "gif" ? "gif" : subtype === "bmp" ? "bmp" : "jpg";
    const base64 = match[2];
    const size = await loadImageSize(fig.data_url);
    if (!size || size.width <= 0 || size.height <= 0) continue;
    const scale = Math.min(DOCX_FIGURE_MAX_W / size.width, DOCX_FIGURE_MAX_H / size.height, 1);
    out.push(
      new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [
          new ImageRun({
            type: docxType,
            data: base64,
            transformation: {
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
            },
          }),
        ],
      }),
    );
  }
  return out;
}

async function docxQuestion(
  q: GeneratedQuestion,
  num: number,
  sheet: HomeworkSheet,
): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { before: 220, after: 40 },
      children: [
        new TextRun({ text: `Q${num}.  `, bold: true, size: 22, color: "24326B" }),
        new TextRun({
          text: `${q.question_type.replace(/_/g, " ")} · ${marksLabel(q.marks)}`,
          size: 16,
          color: "6E7896",
        }),
      ],
    }),
    ...docxMarkdownBlocks(q.prompt),
    ...(await docxFigures(q.figures)),
  ];

  if (q.question_type === "mcq" || q.question_type === "true_false") {
    (q.options ?? []).forEach((opt, i) => {
      const correct = sheet === "answer" && q.correct_option === i;
      out.push(
        new Paragraph({
          indent: { left: 480 },
          children: [
            new TextRun({
              text: `${LETTERS[i] ?? i + 1}.  ${stripOptionLabel(opt)}${correct ? "   (correct)" : ""}`,
              size: 20,
              bold: correct,
              color: correct ? "24326B" : undefined,
            }),
          ],
        }),
      );
    });
  } else if (q.question_type === "fill_blank") {
    if (sheet === "answer") {
      const also = (q.acceptable_answers ?? []).filter(Boolean);
      out.push(
        new Paragraph({
          indent: { left: 480 },
          children: [
            new TextRun({ text: "Answer: ", bold: true, size: 20 }),
            new TextRun({ text: q.expected_answer ?? "—", size: 20 }),
            ...(also.length
              ? [new TextRun({ text: `  (also: ${also.join(", ")})`, size: 18, color: "6E7896" })]
              : []),
          ],
        }),
      );
    } else {
      out.push(
        new Paragraph({
          indent: { left: 480 },
          spacing: { before: 40 },
          children: [
            new TextRun({ text: "Answer: ", size: 20, color: "6E7896" }),
            new TextRun({ text: "_".repeat(60), size: 20, color: "AAB2C2" }),
          ],
        }),
      );
    }
  } else if (sheet === "answer") {
    out.push(
      new Paragraph({
        indent: { left: 480 },
        spacing: { before: 60, after: 20 },
        children: [new TextRun({ text: "Mark scheme", bold: true, size: 18, color: "24326B" })],
      }),
    );
    (q.mark_scheme ?? []).forEach((p) => {
      out.push(
        new Paragraph({
          indent: { left: 720 },
          bullet: { level: 0 },
          children: [
            new TextRun({ text: p.point, size: 20 }),
            new TextRun({ text: `  (${marksLabel(p.marks)})`, size: 18, color: "6E7896" }),
          ],
        }),
      );
    });
  } else {
    // Writing space on the question sheet — a few blank lines.
    const lines = Math.max(3, Math.min(10, Math.ceil(q.marks * 1.2)));
    for (let i = 0; i < lines; i++) {
      out.push(
        new Paragraph({
          indent: { left: 480 },
          spacing: { before: 80 },
          children: [new TextRun({ text: "_".repeat(72), size: 20, color: "AAB2C2" })],
        }),
      );
    }
  }

  return out;
}

export async function exportHomeworkPaperDocx(
  paper: GeneratedPaper,
  sheet: HomeworkSheet,
  meta: HomeworkExportMeta = {},
) {
  const content = paper.questions_json;
  if (!content) return;

  const metaLine = [meta.studentDisplay ?? `Student ${paper.student_id}`, meta.subjectName, meta.curriculumName]
    .filter(Boolean)
    .join("  |  ");

  const questionBlocks = (
    await Promise.all(content.questions.map((q, i) => docxQuestion(q, i + 1, sheet)))
  ).flat();

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: sheetTitle(sheet), bold: true, size: 32, color: "24326B" })],
          }),
          new Paragraph({
            spacing: { after: 20 },
            children: [new TextRun({ text: metaLine, size: 20, color: "64748B" })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `${paper.difficulty} · ${content.total_questions} questions · ${content.total_marks} marks`,
                size: 18,
                color: "94A3B8",
              }),
            ],
          }),
          ...questionBlocks,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBase(paper, sheet)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

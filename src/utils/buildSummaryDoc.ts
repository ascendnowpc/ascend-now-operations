import { Document, Paragraph, TextRun, HeadingLevel } from "docx";

function summaryParagraphs(text: string): Paragraph[] {
  const lines = text.split("\n");
  return lines.map((line) => {
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (!trimmed) {
      return new Paragraph({ children: [] });
    }

    // Sub-bullet: deeply indented or starts with "    -"
    if (indent >= 4 && trimmed.startsWith("-")) {
      return new Paragraph({
        children: [new TextRun({ text: trimmed.slice(1).trim(), size: 20 })],
        indent: { left: 1440 },
        bullet: { level: 1 },
      });
    }

    // Bullet: starts with "- "
    if (trimmed.startsWith("- ")) {
      return new Paragraph({
        children: [new TextRun({ text: trimmed.slice(2), size: 20 })],
        indent: { left: 720 },
        bullet: { level: 0 },
      });
    }

    // Section header: short line, no period at end, no dash prefix
    if (trimmed.length < 60 && !trimmed.endsWith(".") && !trimmed.startsWith("-") && /^[A-Z]/.test(trimmed)) {
      return new Paragraph({
        children: [new TextRun({ text: trimmed, bold: true, size: 22 })],
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160 },
      });
    }

    return new Paragraph({
      children: [new TextRun({ text: trimmed, size: 20 })],
      indent: indent > 0 ? { left: Math.min(indent * 60, 720) } : undefined,
    });
  });
}

export function buildSummaryDoc(summary: string, studentId: string, sessionDate: string, videoLink?: string): Document {
  return new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [new TextRun({ text: "Session Transcript", bold: true, size: 32, color: "1e3a5f" })],
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `Student: ${studentId}  |  Date: ${sessionDate}`, size: 20, color: "64748b" })],
          spacing: { after: videoLink ? 60 : 240 },
        }),
        ...(videoLink
          ? [new Paragraph({
              children: [new TextRun({ text: `Fathom recording: ${videoLink}`, size: 20, color: "64748b" })],
              spacing: { after: 240 },
            })]
          : []),
        ...summaryParagraphs(summary),
      ],
    }],
  });
}

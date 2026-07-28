// A minimal Markdown -> block parser used only for exporting a question's
// transcribed prompt to PDF/DOCX, where neither jsPDF nor `docx` can render
// Markdown directly (the on-screen views use react-markdown instead — see
// QuestionContent.tsx). Handles exactly the subset parse-homework-paper's
// EXTRACTION_PROMPT asks Gemini to use: paragraphs and GFM pipe tables, with
// simple inline emphasis (bold/italic/code) stripped to plain text rather than
// converted to rich runs — full inline rich-text export isn't worth the extra
// plumbing here, since the table structure (the thing that was actually being
// lost before this) is the part that matters for grading/reading a transcribed
// paper.

export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "table"; header: string[]; rows: string[][] };

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, "$1$2")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/;

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => stripInlineMarkdown(cell.trim()));
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paraBuffer: string[] = [];

  function flushParagraph() {
    if (paraBuffer.length === 0) return;
    const text = paraBuffer.map((l) => stripInlineMarkdown(l)).join("\n");
    if (text.trim()) blocks.push({ type: "paragraph", text });
    paraBuffer = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    paraBuffer.push(line);
    i++;
  }
  flushParagraph();
  return blocks.length ? blocks : [{ type: "paragraph", text: "" }];
}

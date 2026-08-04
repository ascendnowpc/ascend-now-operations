// Converts docs/CODE_ARCHITECTURE.md into a Word document.
// Handles the subset of Markdown that file actually uses: ATX headings,
// paragraphs, bullet/ordered lists, GFM tables, fenced code blocks,
// blockquotes, thematic breaks, and inline code/bold/italic/links.

const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageBreak, TableOfContents, LevelFormat, ExternalHyperlink,
} = require("docx");

const SRC = process.argv[2];
const OUT = process.argv[3];

const NAVY = "273267";
const NAVY_MID = "4A5170";
const GREY = "6C7290";
const RULE = "DFE1EE";
const CODE_BG = "F1F2F8";
const HEAD_BG = "EDEFF7";
const CODE_FONT = "Consolas";
const BODY_FONT = "Calibri";

const PAGE_W = 12240, MARGIN = 1080;            // US Letter, 0.75" margins
const CONTENT_W = PAGE_W - MARGIN * 2;          // 10080 dxa

// ---------------------------------------------------------------- inline

function inlineRuns(text, base = {}) {
  const runs = [];
  // Split on `code`, **bold**, *italic*, and [label](url) — in that order of
  // precedence, matching how the source file uses them.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\n]+\*)/g;
  let last = 0, m;
  const push = (t, opts) => { if (t) runs.push(new TextRun({ text: t, font: BODY_FONT, size: 20, ...base, ...opts })); };

  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    if (m[1]) {
      runs.push(new TextRun({
        text: m[1].slice(1, -1), font: CODE_FONT, size: 18,
        color: NAVY, shading: { type: ShadingType.CLEAR, fill: CODE_BG }, ...base,
      }));
    } else if (m[2]) {
      push(m[2].slice(2, -2), { bold: true });
    } else if (m[3]) {
      const lm = m[3].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = lm[1], url = lm[2];
      if (/^https?:/.test(url)) {
        runs.push(new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: label, font: BODY_FONT, size: 20, color: "2C6FB5", underline: {}, ...base })],
        }));
      } else {
        // Relative repo path — render as code, the link would not resolve.
        runs.push(new TextRun({ text: label, font: CODE_FONT, size: 18, color: NAVY, ...base }));
      }
    } else if (m[4]) {
      push(m[4].slice(1, -1), { italics: true });
    }
    last = re.lastIndex;
  }
  push(text.slice(last));
  return runs.length ? runs : [new TextRun({ text: "", font: BODY_FONT, size: 20 })];
}

const stripInline = (s) => s
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/\*([^*\n]+)\*/g, "$1");

// ---------------------------------------------------------------- blocks

function heading(text, level) {
  const map = {
    1: { size: 40, level: HeadingLevel.HEADING_1, before: 0,   after: 200 },
    2: { size: 28, level: HeadingLevel.HEADING_1, before: 360, after: 140 },
    3: { size: 23, level: HeadingLevel.HEADING_2, before: 260, after: 100 },
    4: { size: 21, level: HeadingLevel.HEADING_3, before: 220, after: 80  },
  }[level];
  return new Paragraph({
    heading: map.level,
    spacing: { before: map.before, after: map.after },
    keepNext: true,
    ...(level === 2 ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } } } : {}),
    children: [new TextRun({ text: stripInline(text), font: BODY_FONT, size: map.size, bold: true, color: NAVY })],
  });
}

function para(text) {
  return new Paragraph({
    spacing: { after: 140, line: 280 },
    children: inlineRuns(text),
  });
}

function listItem(text, ordered, index) {
  return new Paragraph({
    spacing: { after: 70, line: 270 },
    ...(ordered
      ? { numbering: { reference: "ordered", level: 0, instance: index } }
      : { bullet: { level: 0 } }),
    children: inlineRuns(text),
  });
}

function codeBlock(lines) {
  return lines.map((line, i) => new Paragraph({
    spacing: { after: 0, line: 240, before: i === 0 ? 60 : 0 },
    shading: { type: ShadingType.CLEAR, fill: CODE_BG },
    indent: { left: 160, right: 160 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: "C9CEE6", space: 6 },
      ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 2, color: CODE_BG, space: 4 } } : {}),
    },
    children: [new TextRun({ text: line.replace(/\t/g, "  ") || " ", font: CODE_FONT, size: 15, color: "1F2438" })],
  }));
}

function quote(text) {
  return new Paragraph({
    spacing: { before: 120, after: 160, line: 280 },
    indent: { left: 280 },
    border: { left: { style: BorderStyle.SINGLE, size: 14, color: "CEE177", space: 10 } },
    children: inlineRuns(text, { italics: true, color: NAVY_MID }),
  });
}

function rule() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
    children: [new TextRun({ text: "", size: 2 })],
  });
}

function cellParagraphs(text, isHeader) {
  // A cell may carry <br>-free multi-item content; split on " · " stays inline.
  return [new Paragraph({
    spacing: { before: 40, after: 40, line: 250 },
    children: inlineRuns(text, isHeader ? { bold: true, color: NAVY } : {}),
  })];
}

function buildTable(rows) {
  const cols = rows[0].length;
  // Weight the first column wider when there are few columns — these tables
  // are almost always "name → explanation".
  let widths;
  if (cols === 2) widths = [0.34, 0.66];
  else if (cols === 3) widths = [0.26, 0.20, 0.54];
  else widths = new Array(cols).fill(1 / cols);
  const columnWidths = widths.map((w) => Math.round(CONTENT_W * w));
  // Fix rounding drift so the columns sum exactly to the table width.
  columnWidths[cols - 1] += CONTENT_W - columnWidths.reduce((a, b) => a + b, 0);

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths,
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left:   { style: BorderStyle.SINGLE, size: 4, color: RULE },
      right:  { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: rows.map((cells, r) => new TableRow({
      tableHeader: r === 0,
      children: cells.map((c, i) => new TableCell({
        width: { size: columnWidths[i], type: WidthType.DXA },
        shading: r === 0 ? { type: ShadingType.CLEAR, fill: HEAD_BG } : undefined,
        margins: { top: 60, bottom: 60, left: 110, right: 110 },
        children: cellParagraphs(c, r === 0),
      })),
    })),
  });
}

// ---------------------------------------------------------------- parser

function parse(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  let orderedInstance = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push(...codeBlock(buf));
      out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: "", size: 2 })] }));
      continue;
    }

    // table
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? "")) {
      const rows = [];
      const split = (l) => l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
      rows.push(split(line));
      i += 2;
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(split(lines[i])); i++; }
      const cols = rows[0].length;
      out.push(buildTable(rows.map((r) => {
        const c = r.slice(0, cols);
        while (c.length < cols) c.push("");
        return c;
      })));
      out.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "", size: 2 })] }));
      continue;
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(heading(h[2], h[1].length)); i++; continue; }

    // thematic break
    if (/^---+\s*$/.test(line)) { out.push(rule()); i++; continue; }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(quote(buf.join(" ").trim()));
      continue;
    }

    // bullet list
    if (/^[-*]\s+/.test(line)) {
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        out.push(listItem(lines[i].replace(/^[-*]\s+/, ""), false));
        i++;
      }
      out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "", size: 2 })] }));
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      orderedInstance++;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        out.push(listItem(lines[i].replace(/^\d+\.\s+/, ""), true, orderedInstance));
        i++;
      }
      out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "", size: 2 })] }));
      continue;
    }

    // blank
    if (!line.trim()) { i++; continue; }

    // paragraph — join wrapped lines
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
           !/^(#{1,4}\s|```|\||>|[-*]\s|\d+\.\s|---+\s*$)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(para(buf.join(" ")));
  }
  return out;
}

// ---------------------------------------------------------------- assemble

const md = fs.readFileSync(SRC, "utf8");

// Drop the H1 and the hand-written contents list — the cover page and the
// generated TOC replace both.
const lines = md.split("\n");
const startIdx = lines.findIndex((l) => /^## 1\. The system in one diagram/.test(l));
const body = parse(lines.slice(startIdx).join("\n"));

const cover = [
  new Paragraph({ spacing: { before: 2600, after: 0 }, children: [
    new TextRun({ text: "ASCEND NOW OPERATIONS", font: BODY_FONT, size: 20, bold: true, color: GREY, characterSpacing: 60 }),
  ]}),
  new Paragraph({ spacing: { before: 160, after: 60 }, children: [
    new TextRun({ text: "Code Architecture", font: BODY_FONT, size: 68, bold: true, color: NAVY }),
  ]}),
  new Paragraph({ spacing: { after: 300 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "CEE177", space: 8 } }, children: [
    new TextRun({ text: "", size: 2 }),
  ]}),
  new Paragraph({ spacing: { after: 160, line: 300 }, children: [
    new TextRun({
      text: "A file-level map of the codebase: what each layer is responsible for, which file talks to which, and how data actually moves from a click to a database row and back.",
      font: BODY_FONT, size: 24, color: NAVY_MID,
    }),
  ]}),
  new Paragraph({ spacing: { before: 500, line: 280 }, children: [
    new TextRun({ text: "This document is about code structure, not features. For what the system does, see README.md. For the exact database schema, see db/docs/VERIFIED_DATABASE_STATE.md. For a narrated walkthrough of the business flows, see SYSTEM_WORKFLOW.md.", font: BODY_FONT, size: 19, color: GREY }),
  ]}),
  new Paragraph({ spacing: { before: 700 }, children: [
    new TextRun({ text: "Source: docs/CODE_ARCHITECTURE.md", font: CODE_FONT, size: 17, color: GREY }),
  ]}),
  new Paragraph({ spacing: { before: 60 }, children: [
    new TextRun({ text: "Generated 4 August 2026", font: BODY_FONT, size: 18, color: GREY }),
  ]}),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { after: 200 }, children: [
    new TextRun({ text: "Contents", font: BODY_FONT, size: 32, bold: true, color: NAVY }),
  ]}),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  creator: "Ascend Now",
  title: "Ascend Now Operations — Code Architecture",
  description: "File-level map of the codebase: layers, data flow, and the frontend/backend split.",
  styles: {
    default: {
      document: { run: { font: BODY_FONT, size: 20, color: "1F2438" } },
    },
  },
  numbering: {
    config: Array.from({ length: 40 }, (_, n) => ({
      reference: "ordered",
      instance: n + 1,
      levels: [{
        level: 0,
        format: LevelFormat.DECIMAL,
        text: "%1.",
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 460, hanging: 300 } } },
      }],
    })),
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: 15840 },
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      },
    },
    children: [...cover, ...body],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("wrote", OUT, buf.length, "bytes");
});

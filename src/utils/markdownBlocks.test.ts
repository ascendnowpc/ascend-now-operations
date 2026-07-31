import { describe, it, expect } from "vitest";
import { parseMarkdownBlocks } from "./markdownBlocks";

describe("parseMarkdownBlocks — paragraphs", () => {
  it("returns a single paragraph for plain prose", () => {
    expect(parseMarkdownBlocks("Explain the term 'economy of scale'.")).toEqual([
      { type: "paragraph", text: "Explain the term 'economy of scale'." },
    ]);
  });

  it("keeps consecutive lines together, newlines intact", () => {
    const [block] = parseMarkdownBlocks("Line one\nLine two");
    expect(block).toEqual({ type: "paragraph", text: "Line one\nLine two" });
  });

  it("normalises CRLF line endings", () => {
    expect(parseMarkdownBlocks("Line one\r\nLine two")).toEqual([
      { type: "paragraph", text: "Line one\nLine two" },
    ]);
  });

  it("always returns at least one block, so callers never special-case empty", () => {
    expect(parseMarkdownBlocks("")).toEqual([{ type: "paragraph", text: "" }]);
    expect(parseMarkdownBlocks("   \n  ")).toEqual([{ type: "paragraph", text: "" }]);
    expect(parseMarkdownBlocks(undefined as unknown as string)).toEqual([
      { type: "paragraph", text: "" },
    ]);
  });
});

describe("parseMarkdownBlocks — inline emphasis is stripped to plain text", () => {
  it("strips bold, italic and inline code", () => {
    expect(parseMarkdownBlocks("**Define** the *term* `profit`.")).toEqual([
      { type: "paragraph", text: "Define the term profit." },
    ]);
  });

  it("leaves a lone asterisk (a bullet or a footnote marker) alone", () => {
    const [block] = parseMarkdownBlocks("* requires working");
    expect(block).toEqual({ type: "paragraph", text: "* requires working" });
  });
});

describe("parseMarkdownBlocks — GFM pipe tables", () => {
  const table = [
    "| Year | Revenue |",
    "| --- | --- |",
    "| 2024 | $3.5m |",
    "| 2025 | $4.0m |",
  ].join("\n");

  it("parses the header and every body row", () => {
    expect(parseMarkdownBlocks(table)).toEqual([
      {
        type: "table",
        header: ["Year", "Revenue"],
        rows: [
          ["2024", "$3.5m"],
          ["2025", "$4.0m"],
        ],
      },
    ]);
  });

  it("accepts an alignment separator row", () => {
    const aligned = "| A | B |\n| :--- | ---: |\n| 1 | 2 |";
    const [block] = parseMarkdownBlocks(aligned);
    expect(block).toEqual({ type: "table", header: ["A", "B"], rows: [["1", "2"]] });
  });

  it("strips emphasis inside cells", () => {
    const [block] = parseMarkdownBlocks("| **Year** | Revenue |\n| --- | --- |\n| *2024* | 1 |");
    expect(block).toEqual({ type: "table", header: ["Year", "Revenue"], rows: [["2024", "1"]] });
  });

  it("parses a header-only table with no body rows", () => {
    expect(parseMarkdownBlocks("| A | B |\n| --- | --- |")).toEqual([
      { type: "table", header: ["A", "B"], rows: [] },
    ]);
  });

  it("keeps the prose before and after a table as its own paragraphs", () => {
    const blocks = parseMarkdownBlocks(`Study the table below.\n\n${table}\n\nNow answer part (a).`);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    // Blank lines around the table stay in the surrounding paragraph text.
    expect((blocks[0] as { text: string }).text.trim()).toBe("Study the table below.");
    expect((blocks[2] as { text: string }).text.trim()).toBe("Now answer part (a).");
  });

  it("treats a pipe row with no separator as ordinary text, not a table", () => {
    const blocks = parseMarkdownBlocks("| not | a | table |\n| still not |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });
});

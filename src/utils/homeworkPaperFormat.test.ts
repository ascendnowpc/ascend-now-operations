import { describe, it, expect } from "vitest";
import { marksLabel, sheetTitle, fileBase, dataUrlImageFormat } from "./homeworkPaperFormat";
import type { GeneratedPaper } from "../types/database";

const paper = { student_id: 42 } as GeneratedPaper;

describe("marksLabel", () => {
  it("uses the singular only for exactly one mark", () => {
    expect(marksLabel(1)).toBe("1 mark");
    expect(marksLabel(2)).toBe("2 marks");
  });

  it("pluralises zero marks", () => {
    expect(marksLabel(0)).toBe("0 marks");
  });

  it("keeps fractional marks plural", () => {
    expect(marksLabel(1.5)).toBe("1.5 marks");
  });
});

describe("sheetTitle", () => {
  it("titles the teacher sheet as the answer sheet", () => {
    expect(sheetTitle("answer")).toBe("Homework — Answer Sheet");
  });

  it("titles the student sheet as the question sheet", () => {
    expect(sheetTitle("question")).toBe("Homework — Question Sheet");
  });
});

describe("fileBase", () => {
  it("names the download by student and sheet so the two sheets never collide", () => {
    expect(fileBase(paper, "answer")).toBe("homework_42_answer-sheet");
    expect(fileBase(paper, "question")).toBe("homework_42_question-sheet");
  });

  it("carries no extension — the PDF and DOCX exporters append their own", () => {
    expect(fileBase(paper, "answer")).not.toContain(".");
  });
});

describe("dataUrlImageFormat", () => {
  it("reads the format from the data URL rather than assuming PNG", () => {
    expect(dataUrlImageFormat("data:image/png;base64,AAAA")).toBe("PNG");
    expect(dataUrlImageFormat("data:image/webp;base64,AAAA")).toBe("WEBP");
  });

  it("maps both jpeg and jpg spellings to jsPDF's JPEG", () => {
    expect(dataUrlImageFormat("data:image/jpeg;base64,AAAA")).toBe("JPEG");
    expect(dataUrlImageFormat("data:image/jpg;base64,AAAA")).toBe("JPEG");
  });

  it("is case insensitive about the mime subtype", () => {
    expect(dataUrlImageFormat("data:image/PNG;base64,AAAA")).toBe("PNG");
  });

  it("returns null for an image format jsPDF cannot embed", () => {
    expect(dataUrlImageFormat("data:image/gif;base64,AAAA")).toBeNull();
    expect(dataUrlImageFormat("data:image/svg+xml;base64,AAAA")).toBeNull();
  });

  it("returns null for anything that is not a base64 image data URL", () => {
    expect(dataUrlImageFormat("https://example.com/x.png")).toBeNull();
    expect(dataUrlImageFormat("data:application/pdf;base64,AAAA")).toBeNull();
    expect(dataUrlImageFormat("data:image/png,AAAA")).toBeNull();
    expect(dataUrlImageFormat("")).toBeNull();
  });
});

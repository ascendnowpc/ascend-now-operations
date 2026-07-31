import { describe, it, expect } from "vitest";
import { isPhotoAnswer, wholePaperAnswerFiles } from "./database";
import type { HomeworkAnswer, WholePaperAnswer } from "./database";

describe("isPhotoAnswer — which answers are manually graded uploads", () => {
  it("recognises an uploaded answer", () => {
    const answer: HomeworkAnswer = {
      kind: "photo",
      files: [{ file_url: "BATO26-1/a.jpg", file_name: "a.jpg" }],
    };
    expect(isPhotoAnswer(answer)).toBe(true);
  });

  it("stays true for a PDF upload — 'photo' is the storage kind, not the file type", () => {
    expect(
      isPhotoAnswer({ kind: "photo", files: [{ file_url: "s/a.pdf", file_name: "a.pdf" }] })
    ).toBe(true);
  });

  it("is true even with no files attached yet", () => {
    expect(isPhotoAnswer({ kind: "photo", files: [] })).toBe(true);
  });

  it("rejects typed and multiple-choice answers", () => {
    expect(isPhotoAnswer("A written answer")).toBe(false);
    expect(isPhotoAnswer(2)).toBe(false);
    expect(isPhotoAnswer(0)).toBe(false);
    expect(isPhotoAnswer("")).toBe(false);
  });

  it("rejects an unanswered question without throwing on null", () => {
    expect(isPhotoAnswer(null)).toBe(false);
  });
});

describe("wholePaperAnswerFiles — legacy and multi-file shapes", () => {
  it("returns the files array when present", () => {
    const wpa: WholePaperAnswer = {
      file_url: "BATO26-1/p1.jpg",
      file_name: "p1.jpg",
      files: [
        { file_url: "BATO26-1/p1.jpg", file_name: "p1.jpg" },
        { file_url: "BATO26-1/p2.jpg", file_name: "p2.jpg" },
      ],
    };
    expect(wholePaperAnswerFiles(wpa)).toEqual(wpa.files);
  });

  it("falls back to the flat file_url/file_name for legacy single-file rows", () => {
    expect(wholePaperAnswerFiles({ file_url: "BATO26-1/paper.pdf", file_name: "paper.pdf" })).toEqual([
      { file_url: "BATO26-1/paper.pdf", file_name: "paper.pdf" },
    ]);
  });

  it("falls back to the flat fields when files is present but empty", () => {
    expect(
      wholePaperAnswerFiles({ file_url: "BATO26-1/paper.pdf", file_name: "paper.pdf", files: [] })
    ).toEqual([{ file_url: "BATO26-1/paper.pdf", file_name: "paper.pdf" }]);
  });

  it("returns nothing when there's no whole-paper answer", () => {
    expect(wholePaperAnswerFiles(null)).toEqual([]);
  });

  it("preserves file order, so annotation slot indexes line up for teacher and student", () => {
    const files = [
      { file_url: "s/1.jpg", file_name: "1.jpg" },
      { file_url: "s/2.jpg", file_name: "2.jpg" },
      { file_url: "s/3.jpg", file_name: "3.jpg" },
    ];
    expect(wholePaperAnswerFiles({ ...files[0], files })).toEqual(files);
  });
});

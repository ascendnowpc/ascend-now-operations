import { describe, it, expect } from "vitest";
import { splitLineNumberedText } from "./lineNumberedText";

describe("splitLineNumberedText — passages with no margin numbering", () => {
  it("is a no-op for ordinary prose", () => {
    const text = "Zed Ltd is a family business that makes garden furniture.";
    expect(splitLineNumberedText(text)).toEqual({
      numbered: false,
      rows: [{ n: null, text }],
    });
  });

  it("needs at least three markers — two stray numbers aren't a sequence", () => {
    const text = "5 In year one it grew. 10 In year two it grew again.";
    expect(splitLineNumberedText(text).numbered).toBe(false);
  });

  it("leaves currency, percentages, years and grouped thousands alone", () => {
    const text =
      "Revenue was $100 million in 2016, up 20% on the prior year, at a cost of 25 000 dollars.";
    expect(splitLineNumberedText(text).numbered).toBe(false);
  });
});

describe("splitLineNumberedText — every-5 margin numbering", () => {
  const text =
    "Case study: Festival Cleaners\n" +
    "The firm was founded in a garage. 5 It now employs forty people " +
    "across three depots. 10 Demand peaks in the summer months. " +
    "15 Managers are considering expansion.";
  const result = splitLineNumberedText(text);

  it("detects the numbering", () => {
    expect(result.numbered).toBe(true);
  });

  it("emits the pre-first-number material as an unnumbered leading row", () => {
    expect(result.rows[0].n).toBeNull();
    expect(result.rows[0].text).toContain("Case study: Festival Cleaners");
    expect(result.rows[0].text).toContain("founded in a garage.");
  });

  it("emits one row per margin number, in order", () => {
    expect(result.rows.slice(1).map((r) => r.n)).toEqual([5, 10, 15]);
  });

  it("strips the margin number off the row's text", () => {
    expect(result.rows[1].text).toBe("It now employs forty people across three depots.");
    expect(result.rows[2].text).toBe("Demand peaks in the summer months.");
    expect(result.rows[3].text).toBe("Managers are considering expansion.");
  });

  it("never loses text — every word survives the split", () => {
    const rejoined = result.rows.map((r) => r.text).join(" ");
    for (const word of ["garage", "depots", "summer", "expansion"]) {
      expect(rejoined).toContain(word);
    }
  });
});

describe("splitLineNumberedText — other intervals and shapes", () => {
  it("handles every-10 numbering", () => {
    const text = "10 First line here. 20 Second line here. 30 Third line here.";
    const { numbered, rows } = splitLineNumberedText(text);
    expect(numbered).toBe(true);
    expect(rows.map((r) => r.n)).toEqual([10, 20, 30]);
  });

  it("handles every-1 numbering", () => {
    const text = "1 First line. 2 Second line. 3 Third line. 4 Fourth line.";
    const { numbered, rows } = splitLineNumberedText(text);
    expect(numbered).toBe(true);
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4]);
  });

  it("omits the leading unnumbered row when the passage starts at a number", () => {
    const { rows } = splitLineNumberedText("5 One. 10 Two. 15 Three.");
    expect(rows[0].n).toBe(5);
  });

  it("skips content numbers sitting between two real markers", () => {
    const text =
      "5 The firm runs 60 stages at the festival. 10 It serves 300 outlets nationwide. " +
      "15 Profits rose last year.";
    const { rows } = splitLineNumberedText(text);
    expect(rows.map((r) => r.n)).toEqual([5, 10, 15]);
    expect(rows[0].text).toContain("60 stages");
    expect(rows[1].text).toContain("300 outlets");
  });

  it("does not start a sequence far down the page (first value must be near the top)", () => {
    const text = "Intro prose. 50 alpha and 55 beta and 60 gamma.";
    expect(splitLineNumberedText(text).numbered).toBe(false);
  });
});

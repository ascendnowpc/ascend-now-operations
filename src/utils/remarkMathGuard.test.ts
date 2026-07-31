import { describe, it, expect } from "vitest";
import { remarkMathGuard } from "./remarkMathGuard";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

// Builds the shape remark-math leaves behind: a root whose paragraph holds the
// candidate math node remark-math decided to create.
function treeWith(node: Node): Node {
  return { type: "root", children: [{ type: "paragraph", children: [node] }] };
}

function runGuard(node: Node): Node {
  const tree = treeWith(node);
  remarkMathGuard()(tree);
  return tree.children![0].children![0];
}

describe("remarkMathGuard — keeps genuine LaTeX as math", () => {
  it("keeps a node containing a LaTeX command", () => {
    const node = { type: "inlineMath", value: "f(x) = \\frac{4x^3}{3} - 16x" };
    expect(runGuard(node)).toEqual(node);
  });

  it("keeps a LaTeX command even when it also contains an English word", () => {
    const node = { type: "inlineMath", value: "\\text{profit margin}" };
    expect(runGuard(node)).toEqual(node);
  });

  it("keeps short variable/operator expressions with no LaTeX command", () => {
    const node = { type: "inlineMath", value: "x^2 + 3y = 12" };
    expect(runGuard(node)).toEqual(node);
  });

  it("keeps display math", () => {
    const node = { type: "math", value: "\\int_0^1 x\\,dx" };
    expect(runGuard(node)).toEqual(node);
  });
});

describe("remarkMathGuard — reverts bare currency back to text", () => {
  it("reverts prose swallowed between two currency dollar signs", () => {
    const node = {
      type: "inlineMath",
      value: "3.5 billion and is forecast to grow to ",
    };
    expect(runGuard(node)).toEqual({
      type: "text",
      value: "$3.5 billion and is forecast to grow to $",
    });
  });

  it("restores the original delimiters — $$ for display, $ for inline", () => {
    expect(runGuard({ type: "math", value: "annual revenue figure" })).toEqual({
      type: "text",
      value: "$$annual revenue figure$$",
    });
  });

  it("reverts an empty or whitespace-only pair", () => {
    expect(runGuard({ type: "inlineMath", value: "" })).toEqual({ type: "text", value: "$$" });
    expect(runGuard({ type: "inlineMath", value: "   " })).toEqual({
      type: "text",
      value: "$   $",
    });
  });

  it("treats any 4+ letter lowercase word as prose, not math", () => {
    expect(runGuard({ type: "inlineMath", value: "cost" }).type).toBe("text");
    // 3 letters isn't enough to look like prose — could be a variable name.
    expect(runGuard({ type: "inlineMath", value: "abc" }).type).toBe("inlineMath");
  });
});

describe("remarkMathGuard — tree walking", () => {
  it("reaches math nested several levels deep", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "blockquote",
          children: [
            {
              type: "paragraph",
              children: [
                { type: "text", value: "Revenue was " },
                { type: "inlineMath", value: "3.5 billion this year and " },
              ],
            },
          ],
        },
      ],
    };
    remarkMathGuard()(tree);
    const para = tree.children![0].children![0];
    expect(para.children![1]).toEqual({
      type: "text",
      value: "$3.5 billion this year and $",
    });
  });

  it("leaves non-math nodes untouched", () => {
    const tree = treeWith({ type: "text", value: "no math here" });
    const before = JSON.stringify(tree);
    remarkMathGuard()(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("handles a leaf node with no children", () => {
    const tree: Node = { type: "root" };
    expect(() => remarkMathGuard()(tree)).not.toThrow();
  });
});

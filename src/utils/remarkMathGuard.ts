// remark-math treats ANY `$...$`/`$$...$$` pair as math, with no regard for
// whether the content actually looks like LaTeX — which breaks badly on this
// app's business-studies-style papers, where a passage routinely has bare
// currency like "...was $3.5 billion and is forecast to grow to $4 billion by
// 2027." remark-math pairs the two dollar signs there and swallows the entire
// sentence between them into one garbled "equation." A math-curriculum paper's
// generated prompts, meanwhile, come back as genuine LaTeX (e.g.
// `$f(x) = \frac{4x^3}{3} - 16x$`) with no instruction from this app to use
// any other notation, so simply disabling `$...$` isn't an option either —
// both conventions coexist across different generated papers (and even, in
// principle, the same one).
//
// This is a remark plugin (run immediately after remarkMath in the pipeline)
// that walks the already-parsed tree and reverts any math node back to plain
// text — reconstructing the original `$...$`/`$$...$$` — unless its content
// actually looks like math. This runs on the parsed AST rather than
// re-matching `$` pairs with a second regex pass, so it exactly matches
// whatever remark-math itself decided was a candidate pair; it's only vetoing
// candidates, not re-discovering them.
function looksLikeMath(value: string): boolean {
  if (!value.trim()) return false;
  if (/\\[a-zA-Z]/.test(value)) return true; // a LaTeX command (\frac, \in, \mathbb, ...)
  // Reject anything containing an ordinary English word (4+ lowercase letters
  // in a row) — real LaTeX is short variables/operators/numbers, not prose.
  if (/[a-z]{4,}/.test(value)) return false;
  return true;
}

interface MathAstNode {
  type: string;
  value?: string;
  children?: MathAstNode[];
}

export function remarkMathGuard() {
  return (tree: MathAstNode) => {
    function walk(node: MathAstNode) {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if ((child.type === "inlineMath" || child.type === "math") && !looksLikeMath(child.value ?? "")) {
          const delims = child.type === "math" ? "$$" : "$";
          node.children[i] = { type: "text", value: `${delims}${child.value}${delims}` };
        } else {
          walk(child);
        }
      }
    }
    walk(tree);
  };
}

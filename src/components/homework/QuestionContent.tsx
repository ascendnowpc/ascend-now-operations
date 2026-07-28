import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import type { QuestionFigure } from "../../types/database";
import { splitLineNumberedText } from "../../utils/lineNumberedText";
import { remarkMathGuard } from "../../utils/remarkMathGuard";
import "katex/dist/katex.min.css";

// Shared "what a question looks like" renderer — used by the review page's
// Answer/Question sheet cards, the student attempt card, and TeacherPaperResults,
// so a parsed question's Markdown (tables, bold, sub-parts) and cropped figures
// (charts/diagrams lifted straight from the uploaded paper) render identically
// everywhere instead of each screen inventing its own text/prose handling.
// remark-breaks keeps a single newline behaving like the old plain-text
// `whitespace-pre-wrap` did (a visual line break, not swallowed the way strict
// CommonMark treats it) — generated (non-parsed) prompts are plain prose, which
// is valid, unstyled Markdown, so nothing changes for them.
//
// remark-math + rehype-katex render LaTeX (`$inline$` / `$$block$$`) — needed
// because a math-curriculum paper's generated prompts/mark schemes come back
// as raw LaTeX (e.g. `$f(x) = \frac{4x^3}{3} - 16x$`) with no instruction from
// this app to use any other notation, and that used to just show as literal
// backslashes and dollar signs. `remarkMathGuard` MUST run right after
// remarkMath — plain `$...$` math parsing is not safe on its own here, since
// this app also generates business-studies papers with bare currency like
// "...was $3.5 billion and is forecast to grow to $4 billion..."; verified
// directly that remark-math pairs those two dollar signs and renders the
// entire sentence between them as garbled math with no guard. remarkMathGuard
// vets each math span remark-math finds and reverts anything that doesn't
// actually look like LaTeX back to plain text — see its own comment for the
// heuristic. `throwOnError: false` is a second safety net for the rarer case
// of a span that passes the look-like-math check but isn't valid TeX (e.g. a
// tight "$50-$75" price range) — KaTeX renders a visible inline error instead
// of throwing and blanking the whole page.
const rehypeKatexOptions = { throwOnError: false, strict: false } as const;
const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-navy-700">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-navy-50 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-navy-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-navy-100 px-2.5 py-1.5 text-left font-semibold text-navy-700">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-navy-100 px-2.5 py-1.5 text-navy-700">{children}</td>,
};

// `className` lets a caller embed this in a differently-sized/colored context
// (e.g. a small muted per-point breakdown line) without the default prose
// sizing — every caller still gets the same Markdown + LaTeX rendering
// underneath, just restyled at the wrapper level.
export function QuestionMarkdown({ text, className = "text-sm text-navy-700" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath, remarkMathGuard]}
        rehypePlugins={[[rehypeKatex, rehypeKatexOptions]]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// A case-study / stimulus passage that carries margin line numbers (5, 10, 15…
// used so a question can say "refer to line 33") is rendered with those numbers
// in a distinct left-margin gutter instead of stranded inline in the prose —
// which is how parse-homework-paper leaves them and what made the passage
// unreadable. splitLineNumberedText is a no-op for a passage with no line
// numbering, so this falls straight back to QuestionMarkdown for those.
function LineNumberedMarkdown({ text }: { text: string }) {
  const { numbered, rows } = splitLineNumberedText(text);
  if (!numbered) return <QuestionMarkdown text={text} />;

  return (
    <div className="text-sm text-navy-700">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-3">
          <span className="w-6 flex-none select-none pt-0.5 text-right font-mono text-xs tabular-nums text-navy-300">
            {row.n ?? ""}
          </span>
          <div className="min-w-0 flex-1">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks, remarkMath, remarkMathGuard]}
              rehypePlugins={[[rehypeKatex, rehypeKatexOptions]]}
              components={markdownComponents}
            >
              {row.text}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}

function FigureImage({ figure }: { figure: QuestionFigure }) {
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (failed) {
    return (
      <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/40 px-3 py-2 text-xs text-navy-400">
        {figure.alt ? `Figure: ${figure.alt}` : "Figure could not be displayed"}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block overflow-hidden rounded-lg border border-navy-100"
      >
        <img
          src={figure.data_url}
          alt={figure.alt || "Figure from the original paper"}
          onError={() => setFailed(true)}
          className="max-h-64 max-w-full object-contain"
        />
      </button>
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/70 p-6"
          onClick={() => setExpanded(false)}
        >
          <img
            src={figure.data_url}
            alt={figure.alt || "Figure from the original paper"}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}

// Renders every figure attached to a question — cropped straight out of the
// uploaded paper by parse-homework-paper, so this is the exact original image,
// not a redrawing. Click to view full-size. Renders nothing if there are none.
export function QuestionFigures({ figures }: { figures?: QuestionFigure[] }) {
  if (!figures || figures.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {figures.map((fig, i) => (
        <FigureImage key={i} figure={fig} />
      ))}
    </div>
  );
}

// Convenience wrapper for the common case: prompt text + its figures, in the
// order they should read (text first, then the visual it refers to).
export function QuestionContent({ prompt, figures }: { prompt: string; figures?: QuestionFigure[] }) {
  return (
    <>
      <QuestionMarkdown text={prompt} />
      <QuestionFigures figures={figures} />
    </>
  );
}

// A section's shared stimulus / case study / source passage + its figures.
// Same as QuestionContent, but renders any margin line numbers in a gutter
// (LineNumberedMarkdown) so a line-numbered case study reads like the original
// paper instead of a jumble of inline numbers.
export function StimulusContent({ text, figures }: { text: string; figures?: QuestionFigure[] }) {
  return (
    <>
      <LineNumberedMarkdown text={text} />
      <QuestionFigures figures={figures} />
    </>
  );
}

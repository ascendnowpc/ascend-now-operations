import { useEffect, useRef, useState } from "react";
import {
  exportHomeworkPaperPdf,
  exportHomeworkPaperDocx,
  type HomeworkSheet,
  type HomeworkExportMeta,
} from "../../utils/exportHomeworkPaper";
import type { GeneratedPaper } from "../../types/database";

interface Props {
  paper: GeneratedPaper;
  sheets: HomeworkSheet[]; // e.g. ["question", "answer"] for teachers, ["question"] for students
  meta?: HomeworkExportMeta;
}

const SHEET_LABEL: Record<HomeworkSheet, string> = {
  question: "Question sheet",
  answer: "Answer sheet",
};

// One sheet's export control, collapsed to a single dropdown button instead of
// a label + two buttons side by side — with both sheets offered (teacher view)
// that used to take up most of the page header's width.
function SheetExportMenu({
  sheet,
  paper,
  meta,
}: {
  sheet: HomeworkSheet;
  paper: GeneratedPaper;
  meta?: HomeworkExportMeta;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-pill border border-navy-100 bg-white px-3 py-1.5 text-xs font-semibold text-navy-600 hover:bg-navy-50"
      >
        {SHEET_LABEL[sheet]}
        <span className={`text-navy-400 text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-navy-100 bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              exportHomeworkPaperPdf(paper, sheet, meta);
            }}
            className="block w-full px-3.5 py-2 text-left text-sm text-navy-700 hover:bg-navy-50"
          >
            Download as PDF
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              exportHomeworkPaperDocx(paper, sheet, meta);
            }}
            className="block w-full px-3.5 py-2 text-left text-sm text-navy-700 hover:bg-navy-50"
          >
            Download as Word
          </button>
        </div>
      )}
    </div>
  );
}

// Phase 8 export controls — one dropdown (PDF/Word) per offered sheet type.
// Students are only ever handed the question sheet; teachers get both.
export function HomeworkExportButtons({ paper, sheets, meta }: Props) {
  if (!paper.questions_json) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {sheets.map((sheet) => (
        <SheetExportMenu key={sheet} sheet={sheet} paper={paper} meta={meta} />
      ))}
    </div>
  );
}

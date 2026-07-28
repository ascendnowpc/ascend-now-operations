import { useMemo } from "react";
import type {
  ContentOutline,
  ContentScope,
  ContentScopePart,
  OutlineChapter,
} from "../../types/database";

interface Props {
  outline: ContentOutline;
  value: ContentScope | null;
  onChange: (scope: ContentScope | null) => void;
}

// One selectable row in the checklist — a whole chapter or a single section.
interface ScopeItem {
  key: string;
  label: string;
  page_start: number;
  page_end: number;
  kind: "chapter" | "section";
  chapterIdx: number;
}

// Two parts refer to the same slice when their page ranges match.
function sameRange(a: { page_start: number; page_end: number }, b: ContentScopePart) {
  return a.page_start === b.page_start && a.page_end === b.page_end;
}

// Builds the ContentScope emitted upward from the checked parts (or null when
// nothing is checked = whole document). `label`/page span summarize the parts.
function buildScope(parts: ContentScopePart[]): ContentScope | null {
  if (parts.length === 0) return null;
  const ordered = [...parts].sort((a, b) => a.page_start - b.page_start);
  const label =
    ordered.length <= 2
      ? ordered.map((p) => p.label).join("; ")
      : `${ordered[0].label} + ${ordered.length - 1} more`;
  return {
    label,
    page_start: Math.min(...ordered.map((p) => p.page_start)),
    page_end: Math.max(...ordered.map((p) => p.page_end)),
    parts: ordered,
  };
}

// Lets a teacher scope homework generation to the whole document or to any
// combination of chapters/sections of an indexed PDF. Emits a ContentScope
// (summary label + page span + the selected `parts`) or null for "whole
// document".
export function ContentScopePicker({ outline, value, onChange }: Props) {
  const chapters: OutlineChapter[] = useMemo(() => outline.chapters ?? [], [outline]);

  // The currently-selected parts. A legacy single-scope value (no `parts`) is
  // treated as one implicit part so it still shows as checked.
  const selectedParts: ContentScopePart[] = useMemo(() => {
    if (!value) return [];
    if (value.parts && value.parts.length) return value.parts;
    return [{ label: value.label, page_start: value.page_start, page_end: value.page_end }];
  }, [value]);

  const items: ScopeItem[] = useMemo(() => {
    const out: ScopeItem[] = [];
    chapters.forEach((ch, ci) => {
      out.push({
        key: `c${ci}`,
        label: ch.title,
        page_start: ch.page_start,
        page_end: ch.page_end,
        kind: "chapter",
        chapterIdx: ci,
      });
      ch.sections.forEach((sec, si) => {
        out.push({
          key: `c${ci}s${si}`,
          label: `${ch.title} · ${sec.title}`,
          page_start: sec.page_start,
          page_end: sec.page_end,
          kind: "section",
          chapterIdx: ci,
        });
      });
    });
    return out;
  }, [chapters]);

  const isChecked = (item: ScopeItem) => selectedParts.some((p) => sameRange(item, p));

  function toggle(item: ScopeItem) {
    const exists = isChecked(item);
    const next = exists
      ? selectedParts.filter((p) => !sameRange(item, p))
      : [
          ...selectedParts,
          { label: item.label, page_start: item.page_start, page_end: item.page_end },
        ];
    onChange(buildScope(next));
  }

  const wholeDoc = selectedParts.length === 0;

  return (
    <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3 flex flex-col gap-2">
      <p className="text-xs font-semibold text-navy-600">
        Generate from specific parts of this book?
      </p>

      <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
        <input
          type="checkbox"
          checked={wholeDoc}
          onChange={() => onChange(null)}
          className="h-3.5 w-3.5 rounded border-navy-200 text-sky-500 focus:ring-sky-300"
        />
        <span className="font-medium">Whole document</span>
      </label>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-navy-100 bg-white/70 p-2 flex flex-col gap-0.5">
        {chapters.map((_, ci) => (
          <div key={ci} className="flex flex-col">
            {items
              .filter((it) => it.chapterIdx === ci)
              .map((it) => (
                <label
                  key={it.key}
                  className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs cursor-pointer hover:bg-sky-50 ${
                    it.kind === "chapter" ? "font-semibold text-navy-700" : "pl-6 text-navy-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked(it)}
                    onChange={() => toggle(it)}
                    className="h-3.5 w-3.5 rounded border-navy-200 text-sky-500 focus:ring-sky-300"
                  />
                  <span className="flex-1">
                    {it.kind === "chapter" ? it.label : it.label.split(" · ").slice(1).join(" · ")}
                  </span>
                  <span className="text-navy-300">
                    p.{it.page_start}–{it.page_end}
                  </span>
                </label>
              ))}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-navy-400">
        {wholeDoc
          ? "Questions will be drawn from the whole document."
          : selectedParts.length === 1
            ? `Questions will be drawn from “${selectedParts[0].label}” (pages ${selectedParts[0].page_start}–${selectedParts[0].page_end}).`
            : `Questions will be drawn from ${selectedParts.length} selected parts, spread across them.`}
      </p>
    </div>
  );
}

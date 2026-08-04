import type { ContentScope, ContentScopePart } from "../types/database";

// Selection rules for the homework generator's chapter/section picker
// (ContentScopePicker). A ContentScopePart carries no id — just a label and a
// page range — so identity has to be derived from both.
//
// Page range alone is NOT enough: a short chapter and every section inside it
// commonly share one page (a chapter on p.3 whose four sections are all on
// p.3), and matching on range alone rendered all five as checked when only one
// was selected. The label is what tells them apart; it stays part of the
// comparison so two genuinely different slices that happen to share a range
// don't collapse into one.

/** Two parts are the same slice when their label and page range both match. */
export function samePart(
  a: { label: string; page_start: number; page_end: number },
  b: ContentScopePart
): boolean {
  return a.label === b.label && a.page_start === b.page_start && a.page_end === b.page_end;
}

export function isPartSelected(
  parts: readonly ContentScopePart[],
  item: { label: string; page_start: number; page_end: number }
): boolean {
  return parts.some((p) => samePart(item, p));
}

/** Adds the part if it isn't selected, removes it if it is. */
export function togglePart(
  parts: readonly ContentScopePart[],
  item: { label: string; page_start: number; page_end: number }
): ContentScopePart[] {
  if (isPartSelected(parts, item)) return parts.filter((p) => !samePart(item, p));
  return [
    ...parts,
    { label: item.label, page_start: item.page_start, page_end: item.page_end },
  ];
}

/**
 * The parts a stored scope selects. A legacy single-scope value (saved before
 * multi-select, so no `parts`) counts as one implicit part, which is what keeps
 * it showing as checked.
 */
export function selectedPartsOf(value: ContentScope | null): ContentScopePart[] {
  if (!value) return [];
  if (value.parts && value.parts.length) return value.parts;
  return [{ label: value.label, page_start: value.page_start, page_end: value.page_end }];
}

/**
 * Builds the scope emitted upward from the checked parts — null when nothing is
 * checked, which means "whole document". `label` and the page span summarise
 * the parts; `parts` keeps them individually so non-contiguous sections survive.
 */
export function buildContentScope(parts: readonly ContentScopePart[]): ContentScope | null {
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

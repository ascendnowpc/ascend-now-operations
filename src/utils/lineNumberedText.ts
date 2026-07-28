// Case-study / stimulus line-number handling.
//
// Exam papers (IGCSE / IBDP business-studies case studies, English source
// passages, etc.) print line numbers down the LEFT MARGIN — 5, 10, 15, 20, …
// every fifth line — so a question can say "refer to line 33". When
// parse-homework-paper transcribes such a passage, those margin numbers end up
// stranded INLINE in the flowing prose ("…clean up after a festival at an
// average 10 cost of $250 000…"), which reads as an unreadable jumble because
// the number looks like part of the sentence.
//
// This module detects that margin-number sequence and splits the passage into
// rows so the renderer can show each number in a distinct left-margin gutter
// (see StimulusContent in QuestionContent.tsx) instead of buried in the text —
// keeping the line references but visually separating them from the words.
//
// It works off the STORED transcription (numbers inline, wherever Gemini left
// them), so it fixes already-parsed papers with no re-parse, and it's a pure
// no-op for any passage that has no line numbering (a normal case study, or a
// generated — non-parsed — prompt).

export interface NumberedRow {
  // The margin line number that labels this row's first line, or null for the
  // material before the first numbered line (title, intro paragraph, …).
  n: number | null;
  // The row's Markdown text, with the leading margin number stripped off.
  text: string;
}

// A candidate margin number: a short standalone integer that labels a line.
interface Marker {
  value: number;
  start: number; // index of the first digit in the source text
  end: number; // index just past the last digit
}

// Line-numbering intervals seen in real papers, tried in preference order.
const ALLOWED_STEPS = [5, 10, 1, 2, 20, 25];

// A margin line number is a 1–3 digit integer that:
//   - is NOT part of a larger token (not preceded by a letter/digit/$/%/./@/-),
//     so "$100", "COVID-19", "3.5", "2016" and the "000" of "25 000" are excluded;
//   - IS followed by whitespace and then a NON-digit, NON-space character — the
//     start of the word/bullet/quote it labels — so "20%" (no space), "25 000"
//     (space then a digit) and "3000 toilets" (four digits) are all excluded,
//     while "5 In", "15 * requires" and "60 stages" all qualify as candidates.
// The loose candidate net is fine: the arithmetic-sequence filter below is the
// real gate on what actually counts as a line number.
const CANDIDATE_RE = /(?<![\p{L}\p{N}.$%@-])(\d{1,3})(?=\s+(?!\d)\S)/gu;

function findCandidates(text: string): Marker[] {
  const out: Marker[] = [];
  for (const m of text.matchAll(CANDIDATE_RE)) {
    const idx = m.index ?? 0;
    out.push({ value: parseInt(m[1], 10), start: idx, end: idx + m[1].length });
  }
  return out;
}

// Finds the longest chain of candidates whose values form an ascending
// arithmetic progression (line numbers: 5,10,15,… or 1,2,3,… or 10,20,30,…),
// consuming them in document order and skipping any content number that falls
// between two real markers ("60 stages", "300 outlets", …). The sequence must
// start near the top (first value ≤ 2·step) and have at least three members —
// enough that an incidental "5 apples, 10 oranges, 15 pears" is the only real
// false-positive risk, and even then the cost is merely three numbers shown in
// the gutter, never mangled or dropped text.
function findMarginNumbers(text: string): Marker[] {
  const candidates = findCandidates(text);
  if (candidates.length < 3) return [];

  let best: Marker[] = [];
  for (const step of ALLOWED_STEPS) {
    for (let s = 0; s < candidates.length; s++) {
      const startVal = candidates[s].value;
      if (startVal <= 0 || startVal % step !== 0 || startVal > step * 2) continue;
      const chain: Marker[] = [candidates[s]];
      let expected = startVal + step;
      for (let j = s + 1; j < candidates.length; j++) {
        if (candidates[j].value === expected) {
          chain.push(candidates[j]);
          expected += step;
        }
      }
      if (chain.length > best.length) best = chain;
    }
    if (best.length >= 3) break; // an earlier (more common) step already won
  }
  return best.length >= 3 ? best : [];
}

// Splits a stimulus into gutter rows. When the passage carries margin line
// numbers, returns one row per numbered line (its number in `n`, that number
// stripped from `text`) plus a leading unnumbered row for anything before the
// first number. When it doesn't, returns the whole thing as a single unnumbered
// row, so the caller renders it exactly as before.
export function splitLineNumberedText(text: string): {
  numbered: boolean;
  rows: NumberedRow[];
} {
  const markers = findMarginNumbers(text);
  if (markers.length === 0) return { numbered: false, rows: [{ n: null, text }] };

  const rows: NumberedRow[] = [];
  const head = text.slice(0, markers[0].start).replace(/\s+$/, "");
  if (head.trim()) rows.push({ n: null, text: head });

  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
    const seg = text.slice(mk.end, end).replace(/^[ \t]+/, "").replace(/\s+$/, "");
    rows.push({ n: mk.value, text: seg });
  }
  return { numbered: true, rows };
}

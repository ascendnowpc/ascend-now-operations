import type { Subject } from "../types/database";

/** Build a human-readable display label for a subject including board/code/level. */
export function subjectDisplayLabel(
  name: string,
  board: string | null,
  subjectCode: string | null,
  level: string | null,
): string {
  const parts: string[] = [name];
  if (board && subjectCode) {
    parts.push(`${board} (${subjectCode})`);
  } else if (board) {
    parts.push(board);
  }
  if (level) parts.push(level);
  return parts.join(" — ");
}

/** Display label for a subject WITHOUT its level (e.g. "English" instead of "English — SL"). */
export function subjectBaseLabel(
  name: string,
  board: string | null,
  subjectCode: string | null,
): string {
  const parts: string[] = [name];
  if (board && subjectCode) {
    parts.push(`${board} (${subjectCode})`);
  } else if (board) {
    parts.push(board);
  }
  return parts.join(" — ");
}

export type SubjectBaseGroup = { key: string; baseLabel: string; items: Subject[] };

/**
 * Groups subjects that share the same name/board/code but differ only by level
 * (e.g. "English" SL/HL) so a UI can offer a single subject choice plus a
 * separate level dropdown, instead of listing the same subject name twice.
 */
export function groupSubjectsByBase(subjects: Subject[]): SubjectBaseGroup[] {
  const map = new Map<string, SubjectBaseGroup>();
  for (const s of subjects) {
    const key = `${s.name}|${s.board ?? ""}|${s.subject_code ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(s);
    } else {
      map.set(key, { key, baseLabel: subjectBaseLabel(s.name, s.board, s.subject_code), items: [s] });
    }
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => (a.level ?? "").localeCompare(b.level ?? ""));
  }
  return Array.from(map.values());
}

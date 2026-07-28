// Maps a subject's `level` (e.g. "Higher Level") to its conventional short form
// so subjects that only differ by level (HL/SL) read unambiguously everywhere.
const LEVEL_ABBREVIATIONS: Record<string, string> = {
  "higher level": "HL",
  "standard level": "SL",
  "advanced subsidiary level": "AS",
  "advanced level": "A2",
  "foundation": "Foundation",
  "higher": "Higher",
  "core": "Core",
  "extended": "Extended",
};

export function levelAbbrev(level: string | null | undefined): string | null {
  if (!level) return null;
  const key = level.trim().toLowerCase();
  return LEVEL_ABBREVIATIONS[key] ?? level;
}

export function subjectLabel(name: string, level: string | null | undefined): string {
  const abbrev = levelAbbrev(level);
  return abbrev ? `${name} (${abbrev})` : name;
}

// What to show for "what was this session about" when a session has no
// subject at all (e.g. College Counselling / College Essays sessions, which
// carry a program type instead of a subject) — falls back subject -> topic
// -> program name, so it never renders as a bare "—" when there's actually
// something to show. Used everywhere a session/pending-deduction row
// displays its subject: the pool-issue email, the "Pending Deduction" queue,
// and the sister-pool reassignment list.
export function sessionTopicLabel(opts: {
  subjectName?: string | null;
  subjectLevel?: string | null;
  topic?: string | null;
  programName?: string | null;
}): string {
  if (opts.subjectName) return subjectLabel(opts.subjectName, opts.subjectLevel ?? null);
  if (opts.topic) return opts.topic;
  if (opts.programName) return opts.programName;
  return "—";
}

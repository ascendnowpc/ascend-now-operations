// The fixed set of curricula a student can be tagged with. This is the
// student's own overall curriculum (shown on the intake form and profile),
// deliberately a small self-contained list rather than the session-level
// `curricula` catalogue used for logging subjects.
export const CURRICULUM_OPTIONS = [
  "IBDP",
  "IB MYP",
  "IGCSE",
  "A Levels",
  "AP",
  "NA",
  "National Curriculum",
  "OTHER",
] as const;

export type Curriculum = (typeof CURRICULUM_OPTIONS)[number];

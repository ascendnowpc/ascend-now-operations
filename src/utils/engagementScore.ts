// Shared with EntityStatsTable and AdminAnalysisPage's engagement drill-down
// so the low/medium/high <-> 1/2/3 mapping and its display label can't drift.
export const ENGAGEMENT_SCORE: Record<string, number> = { low: 1, medium: 2, high: 3 };

export function engagementLabel(v: number | null): string {
  if (v === null) return "—";
  if (v < 1.67) return `${v} · Low`;
  if (v < 2.34) return `${v} · Medium`;
  return `${v} · High`;
}

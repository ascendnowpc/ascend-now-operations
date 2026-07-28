// Formats an hours value without rounding error artifacts (e.g. 0.75 must stay "0.75", not "0.8").
// Rounds to 2 decimal places (enough precision for quarter-hour session logging) and strips trailing zeros.
export function formatHours(hours: number): string {
  const rounded = Math.round((hours + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, "") || "0";
}

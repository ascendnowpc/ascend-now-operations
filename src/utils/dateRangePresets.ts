// Date-range preset + adaptive trend-bucket-granularity helpers for the
// admin Analysis dashboard. Kept separate from the dashboard hook/page so
// the pure date math is easy to reason about (and reuse) on its own.

export type DateRangePreset = "7d" | "30d" | "3m" | "6m" | "12m" | "24m" | "ytd" | "all" | "custom";

export const DEFAULT_DATE_RANGE_PRESET: DateRangePreset = "6m";

export const DATE_RANGE_PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "24m", label: "Last 2 years" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function subDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - days);
  return r;
}

function subMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() - months);
  return r;
}

/** Resolves a preset (or a custom from/to pair) to concrete ISO date bounds. `from: null` means no lower bound ("all time"). */
export function resolvePresetRange(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string
): { from: string | null; to: string } {
  const today = startOfDay(new Date());
  const to = toISODate(today);
  switch (preset) {
    case "7d":
      return { from: toISODate(subDays(today, 6)), to };
    case "30d":
      return { from: toISODate(subDays(today, 29)), to };
    case "3m":
      return { from: toISODate(subMonths(today, 3)), to };
    case "6m":
      return { from: toISODate(subMonths(today, 6)), to };
    case "12m":
      return { from: toISODate(subMonths(today, 12)), to };
    case "24m":
      return { from: toISODate(subMonths(today, 24)), to };
    case "ytd":
      return { from: `${today.getFullYear()}-01-01`, to };
    case "all":
      return { from: null, to };
    case "custom":
      return { from: customFrom || null, to: customTo || to };
  }
}

export type TrendGranularity = "day" | "week" | "month";

/** Picks a trend-chart bucket size from the span of the active range — fine-grained for short windows, coarser for long ones. */
export function pickGranularity(from: Date | null, to: Date): TrendGranularity {
  if (!from) return "month";
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (days <= 35) return "day";
  if (days <= 120) return "week";
  return "month";
}

function mondayOf(d: Date): Date {
  const dayIdx = (d.getDay() + 6) % 7; // 0 = Monday
  return subDays(startOfDay(d), dayIdx);
}

export function bucketKeyForDate(d: Date, granularity: TrendGranularity): string {
  if (granularity === "day") return toISODate(d);
  if (granularity === "week") return toISODate(mondayOf(d));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function bucketLabel(key: string, granularity: TrendGranularity): string {
  if (granularity === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "short", year: "2-digit" });
  }
  const d = new Date(key);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short" });
}

/** Every bucket key spanning [from, to] at the given granularity, so empty buckets still render as zero rather than disappearing. */
export function generateBucketKeys(from: Date, to: Date, granularity: TrendGranularity): string[] {
  const keys: string[] = [];
  if (granularity === "day") {
    let cur = startOfDay(from);
    const end = startOfDay(to);
    while (cur <= end) {
      keys.push(toISODate(cur));
      cur = subDays(cur, -1);
    }
  } else if (granularity === "week") {
    let cur = mondayOf(from);
    const end = mondayOf(to);
    while (cur <= end) {
      keys.push(toISODate(cur));
      cur = subDays(cur, -7);
    }
  } else {
    let cur = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cur <= end) {
      keys.push(bucketKeyForDate(cur, "month"));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  }
  return keys;
}

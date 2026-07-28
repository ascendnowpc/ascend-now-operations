import { formatHours } from "../../utils/formatHours";

// Shared package-status UI used by the read-only student & parent dashboards.
// Kept identical to the admin/PC "Learner's actual hours" look so a
// student/parent sees the same balance presentation staff do — just without
// any of the write actions. (The `courseTypeBadge` class helper lives in its
// own module so this file only exports a component, per react-refresh.)

export function BalanceBar({ used, total }: { used: number; total: number }) {
  // A package can have 0 purchased hours yet still have used hours logged
  // against it (an overage) — treat that as a full (red) bar rather than 0%.
  const rawPct = total > 0 ? used / total : used > 0 ? 1 : 0;
  const pct = Math.min(rawPct, 1);
  const fill = pct >= 0.9 ? "bg-red-500" : pct >= 0.75 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-navy-50 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${fill}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-xs text-navy-500 shrink-0 tabular-nums">
        {formatHours(used)} / {formatHours(total)} hrs used {total > 0 ? `(${Math.round(rawPct * 100)}%)` : used > 0 ? "(over)" : ""}
      </span>
    </div>
  );
}

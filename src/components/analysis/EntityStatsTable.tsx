import { useState, useMemo } from "react";
import { Card } from "../ui/Card";
import type { EntityStat } from "../../hooks/useAnalysisDashboard";
import { engagementLabel } from "../../utils/engagementScore";

type SortKey = "name" | "sessions" | "hours" | "noShowRate" | "flaggedRate" | "avgEngagement";

function numericValue(r: EntityStat, key: Exclude<SortKey, "name">): number {
  switch (key) {
    case "sessions":
      return r.sessions;
    case "hours":
      return r.hours;
    case "noShowRate":
      return r.noShowRate;
    case "flaggedRate":
      return r.flaggedRate;
    case "avgEngagement":
      return r.avgEngagement ?? -1;
  }
}

// "9 of 33 (27.3%)" instead of a bare count next to a bare percentage — the
// two numbers alone made two rows look contradictory (e.g. 9 no-shows at
// 27.3% vs. 2 no-shows at 66.7%) because the rate's denominator was never
// shown. Showing "count of total" makes the math self-evident.
function noShowCell(r: EntityStat): string {
  const total = r.sessions + r.noShowCount;
  if (total === 0) return "0 of 0";
  return `${r.noShowCount} of ${total} (${r.noShowRate}%)`;
}

function flaggedCell(r: EntityStat): string {
  if (r.sessions === 0) return "0 of 0";
  return `${r.flaggedCount} of ${r.sessions} (${r.flaggedRate}%)`;
}

// Sortable ranking/comparison table, shared by the Tutor / Student / PC
// performance sections of the Analysis dashboard. Narrowing the Tutor,
// Student, or Coordinator filter to a handful of entities turns this into a
// direct side-by-side comparison — no separate "compare" widget needed.
export function EntityStatsTable({
  title,
  subtitle,
  rows,
  showHours = true,
  metaLabel,
  defaultSortKey = "hours",
  emptyMessage = "No sessions in this period.",
}: {
  title: string;
  subtitle: string;
  rows: EntityStat[];
  showHours?: boolean;
  metaLabel?: string;
  defaultSortKey?: SortKey;
  emptyMessage?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === "name") {
        const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return sortDir === "asc" ? cmp : -cmp;
      }
      const av = numericValue(a, sortKey);
      const bv = numericValue(b, sortKey);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const columns: { key: SortKey; label: string; align?: "right" }[] = [
    { key: "name", label: "Name" },
    { key: "sessions", label: "Sessions", align: "right" },
    ...(showHours ? [{ key: "hours" as SortKey, label: "Hours", align: "right" as const }] : []),
    { key: "noShowRate", label: "No-shows", align: "right" },
    { key: "flaggedRate", label: "Flagged", align: "right" },
    { key: "avgEngagement", label: "Avg Engagement", align: "right" },
  ];

  return (
    <Card>
      <div className="px-6 py-5 border-b border-navy-50">
        <p className="font-semibold text-navy-700">{title}</p>
        <p className="text-xs text-navy-400 mt-1">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-navy-300 px-6 py-8">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-navy-700">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`px-5 py-3 text-xs font-semibold text-navy-100 uppercase tracking-wide whitespace-nowrap ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(c.key)}
                      className={`flex items-center gap-1 hover:text-white ${c.align === "right" ? "ml-auto" : ""}`}
                    >
                      {c.label}
                      {sortKey === c.key && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ))}
                {metaLabel && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-navy-100 uppercase tracking-wide whitespace-nowrap">{metaLabel}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.id} className={`${i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                  <td className="px-5 py-3.5 border-b border-navy-50 font-medium text-navy-700 whitespace-nowrap">{r.name}</td>
                  <td className="px-5 py-3.5 border-b border-navy-50 text-navy-600 text-right tabular-nums">{r.sessions}</td>
                  {showHours && <td className="px-5 py-3.5 border-b border-navy-50 text-navy-600 text-right tabular-nums">{r.hours}</td>}
                  <td className="px-5 py-3.5 border-b border-navy-50 text-navy-600 text-right tabular-nums whitespace-nowrap">{noShowCell(r)}</td>
                  <td className="px-5 py-3.5 border-b border-navy-50 text-navy-600 text-right tabular-nums whitespace-nowrap">{flaggedCell(r)}</td>
                  <td className="px-5 py-3.5 border-b border-navy-50 text-navy-600 text-right tabular-nums whitespace-nowrap">{engagementLabel(r.avgEngagement)}</td>
                  {metaLabel && <td className="px-5 py-3.5 border-b border-navy-50 text-navy-600">{r.meta ?? "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

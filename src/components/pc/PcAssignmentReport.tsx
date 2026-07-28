import { StarRating } from "../ui/StarRating";
import { Spinner } from "../ui/Spinner";
import { usePcReport, type DropdownAggregate } from "../../hooks/usePcReport";

// Per-PC aggregate report shown when a Performance Coach card is expanded on
// the admin PC Assignments page. It rolls up the latest Performance Coach Log
// of each assigned student into: average of every star rating, and — since a
// mean is meaningless for a category — a distribution (count per option, most
// common highlighted) for every dropdown field.
export function PcAssignmentReport({ studentIds, expanded }: { studentIds: string[]; expanded: boolean }) {
  const { report, loading, error } = usePcReport(studentIds, expanded);

  if (error) {
    return <p className="text-xs text-red-500 py-3">{error}</p>;
  }

  if (loading || !report) {
    return (
      <div className="flex items-center gap-2 text-navy-300 text-xs py-3">
        <Spinner /> Loading report…
      </div>
    );
  }

  if (report.loggedStudentCount === 0) {
    return (
      <p className="text-xs text-navy-400 py-3">
        No Performance Coach Logs filed yet for this coach's students.
      </p>
    );
  }

  const ratingsWithData = report.ratings.filter((r) => r.average != null);
  const n = report.loggedStudentCount;

  return (
    <div className="pt-4 mt-3 border-t border-navy-100 flex flex-col gap-5">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-navy-400">
        Reports · averaged across {n} student{n !== 1 ? "s" : ""}' latest log
      </p>

      {/* Ratings — straight average across each student's latest log */}
      {ratingsWithData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          {ratingsWithData.map((r) => (
            <div key={r.key} className="flex flex-col gap-1">
              <span className="text-[11px] text-navy-500" title={r.helperText}>{r.label}</span>
              <div className="flex items-center gap-2.5">
                <StarRating value={Math.round(r.average as number)} readOnly showValue={false} />
                <span className="text-sm font-semibold text-navy-700 tabular-nums">{(r.average as number).toFixed(1)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dropdowns — distribution, since averaging a category is meaningless */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 pt-4 border-t border-navy-50">
        {report.dropdowns.map((d) => (
          <DropdownBreakdown key={d.key} d={d} />
        ))}
      </div>
    </div>
  );
}

function DropdownBreakdown({ d }: { d: DropdownAggregate }) {
  return (
    <div>
      <p className="text-[11px] text-navy-500 mb-1">{d.label}</p>
      {d.total === 0 ? (
        <p className="text-[11px] text-navy-300">—</p>
      ) : (
        <div className="flex flex-col gap-1">
          {d.items.map((item, i) => {
            const pct = Math.round((item.count / d.total) * 100);
            const isTop = i === 0;
            return (
              <div key={item.label}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs truncate ${isTop ? "text-navy-700 font-semibold" : "text-navy-500"}`}>{item.label}</span>
                  <span className="text-[11px] text-navy-400 tabular-nums shrink-0">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-navy-50 mt-0.5 overflow-hidden">
                  <div className={`h-full rounded-full ${isTop ? "bg-sky-500" : "bg-sky-200"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

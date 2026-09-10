import { formatHours } from "../../utils/formatHours";
import {
  packageUsageSplit,
  siblingColor,
  type SiblingColor,
  type SiblingUsage,
} from "../../utils/familyPackages";

interface FamilyUsageBarProps {
  usage: SiblingUsage[];
  purchasedHours: number;
  /** Stable colour per child, from siblingColorMap over the family's children. */
  colors: Map<string, SiblingColor>;
  /**
   * The viewer's own student id, when a student is looking at their own
   * dashboard. Their slice is marked "You" so a shared bar reads at a glance.
   */
  highlightStudentId?: string | null;
}

/**
 * A package's hours, split by which sibling actually spent them.
 *
 * One segmented bar plus a legend — each child in their own colour, held stable
 * across every screen by siblingColorMap, so the same child is the same colour
 * on the admin's package card, on the parent's dashboard, and on each
 * sibling's own. That is the whole point: on a shared pool, "40 of 50 hours
 * used" doesn't tell a parent anything useful until it says who used them.
 *
 * Safe to render for a student: the numbers come from an aggregate RPC that
 * deliberately exposes totals and nothing else, so a student seeing their
 * sibling's slice still cannot reach that sibling's session logs.
 */
export function FamilyUsageBar({
  usage,
  purchasedHours,
  colors,
  highlightStudentId = null,
}: FamilyUsageBarProps) {
  const split = packageUsageSplit(usage, purchasedHours);

  if (split.slices.length === 0) {
    return (
      <div className="h-2.5 w-full rounded-pill bg-navy-50 overflow-hidden" aria-hidden />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 w-full rounded-pill bg-navy-50 overflow-hidden">
        {split.slices.map((s) => (
          <div
            key={s.studentId}
            className={siblingColor(colors, s.studentId).bar}
            style={{ width: `${s.percent}%` }}
            title={`${s.firstName}: ${formatHours(s.hours)} hrs`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {split.slices.map((s) => (
          <span
            key={s.studentId}
            className={`inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-xs font-medium ${
              siblingColor(colors, s.studentId).chip
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${siblingColor(colors, s.studentId).dot}`} />
            {s.studentId === highlightStudentId ? "You" : s.firstName}
            <span className="font-semibold">{formatHours(s.hours)} hrs</span>
          </span>
        ))}
        {split.overspent && (
          <span className="inline-flex items-center rounded-pill border border-red-100 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
            Over by {formatHours(split.usedHours - split.purchasedHours)} hrs
          </span>
        )}
      </div>
    </div>
  );
}

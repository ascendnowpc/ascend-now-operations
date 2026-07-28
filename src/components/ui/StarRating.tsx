interface StarRatingProps {
  label?: string;
  helperText?: string;
  value: number | null;
  onChange?: (value: number | null) => void;
  max?: number;
  readOnly?: boolean;
  // When read-only, whether to print the "n/max" text after the stars.
  // Defaults to true; pass false where the value is shown separately.
  showValue?: boolean;
}

// 0-5 black-star control shared by all 9 Coordinator Log rating fields.
// Clicking star n sets the rating to n; "Clear" resets to null (not yet
// rated) — there's no separate affordance for an explicit "0", since nothing
// in this feature distinguishes "rated zero" from "not rated yet".
export function StarRating({ label, helperText, value, onChange, max = 5, readOnly = false, showValue = true }: StarRatingProps) {
  const stars = Array.from({ length: max }, (_, i) => i + 1);
  const filled = value ?? 0;

  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-navy-700">{label}</label>}
      {helperText && <p className="text-xs text-navy-400 whitespace-pre-line">{helperText}</p>}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          {stars.map((n) => (
            <button
              key={n}
              type="button"
              disabled={readOnly}
              onClick={() => onChange?.(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className={`p-0.5 text-navy-800 ${readOnly ? "cursor-default" : "cursor-pointer hover:text-navy-500"}`}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill={n <= filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
                <path
                  d="M12 2.5l2.9 6.1 6.6.6-5 4.6 1.5 6.6L12 16.9l-5.9 3.5 1.4-6.6-4.9-4.6 6.6-.6z"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ))}
        </div>
        {!readOnly && value != null && (
          <button type="button" onClick={() => onChange?.(null)} className="text-xs text-navy-300 hover:text-red-400">
            Clear
          </button>
        )}
        {readOnly && showValue && <span className="text-xs text-navy-400">{value != null ? `${value}/${max}` : "—"}</span>}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface RowMenuAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** Compact "⋯" overflow menu — collapses several row-level actions (rename,
 * deactivate, add…) behind a single trigger so list rows stay scannable.
 * Rendered into a portal (fixed-positioned off the trigger's own rect) so it
 * isn't clipped by an ancestor's `overflow-hidden` — rows here are commonly
 * nested inside rounded/clipped cards. */
export function RowMenu({ actions }: { actions: RowMenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleDismiss() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-navy-400 hover:text-navy-700 hover:bg-navy-50 transition-colors flex-shrink-0"
        aria-label="More actions"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 bg-white border border-navy-100 rounded-xl shadow-lg min-w-[170px] py-1"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); a.onClick(); }}
              className={`block w-full text-left px-3.5 py-2 text-sm transition-colors ${
                a.danger ? "text-red-500 hover:bg-red-50" : "text-navy-700 hover:bg-navy-50"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

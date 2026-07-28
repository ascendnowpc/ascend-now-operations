import type { PcProfileIcon } from "../../types/database";

// The small fixed set of icons an admin can pick from for a card entry —
// shared between the editor's icon picker and the profile card's render, for
// both Education entries and Performance Coach timeline stops. The first
// four are education-flavored; the rest cover common coaching
// responsibilities (scheduling, tracking progress, mentoring, etc.).
export const PROFILE_ICONS: { key: PcProfileIcon; label: string }[] = [
  { key: "cap", label: "Degree" },
  { key: "book", label: "Coursework" },
  { key: "certificate", label: "Certification" },
  { key: "school", label: "Institution" },
  { key: "calendar", label: "Scheduling" },
  { key: "chart", label: "Progress" },
  { key: "people", label: "Mentoring" },
  { key: "message", label: "Communication" },
  { key: "target", label: "Goals" },
  { key: "heart", label: "Support" },
];

export function ProfileIcon({ icon, className = "w-4.5 h-4.5" }: { icon: PcProfileIcon; className?: string }) {
  switch (icon) {
    case "book":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5C4.7 20 4 19.3 4 18.5v-13z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5c.8 0 1.5-.7 1.5-1.5v-13z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "certificate":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 13.5L8 20l4-2 4 2-1-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "school":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path d="M3 10l9-5 9 5-9 5-9-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M6 12v5c0 1 2.7 2 6 2s6-1 6-2v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 9h16M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "chart":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path d="M4 17l5-5 4 4 7-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 8h5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "people":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="16" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 18c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5M14.5 18c0-1.8.8-3.2 2.5-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "message":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5v10c0 .8-.7 1.5-1.5 1.5H9l-4 3.5V17h-.5C3.7 17 3 16.3 3 15.5v-10z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "target":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        </svg>
      );
    case "heart":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M12 20s-7-4.5-9.3-9C1.3 8 2 5 5 4.3c2-.5 3.8.4 5 2 1.2-1.6 3-2.5 5-2 3 .7 3.7 3.7 2.3 6.7C19 15.5 12 20 12 20z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "cap":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path d="M12 4L2 9l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 11.5V16c0 1.3 2.7 2.5 6 2.5s6-1.2 6-2.5v-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

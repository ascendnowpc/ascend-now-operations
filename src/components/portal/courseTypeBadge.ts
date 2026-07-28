// Tailwind class string for a course-type badge, keyed by its stored color.
// Shared by the read-only student/parent package views.
export function courseTypeBadge(color: string | null) {
  switch (color) {
    case "green":  return "bg-green-100 text-green-700 border-green-200";
    case "orange": return "bg-orange-100 text-orange-700 border-orange-200";
    case "purple": return "bg-purple-100 text-purple-700 border-purple-200";
    case "sky":    return "bg-sky-100 text-sky-700 border-sky-200";
    case "amber":  return "bg-amber-100 text-amber-700 border-amber-200";
    case "navy":   return "bg-navy-50 text-navy-600 border-navy-100";
    default:       return "bg-navy-50 text-navy-600 border-navy-100";
  }
}

// The admin Overview page is a card rendering of the admin sidebar: one card
// per sidebar section (listing that section's links) plus a card for every
// standalone sidebar link. Keeping the transform here — as a pure function
// over the same nav array AdminLayout renders — is what stops the two from
// drifting apart the way they had before 2026-08-04, when Overview listed
// entries the sidebar didn't have and missed every standalone item.

/** The structural part of DashboardShell's NavItem that Overview cares about. */
export interface AdminNavShape {
  label: string;
  to?: string;
  children?: AdminNavShape[];
}

export interface AdminOverviewSection<T> {
  /** The sidebar group itself (icon + label live on it). */
  group: T;
  /** Its navigable children, in sidebar order. */
  links: T[];
}

export interface AdminOverview<T> {
  sections: AdminOverviewSection<T>[];
  standalone: T[];
}

/**
 * Splits the admin nav into expandable sections and standalone links, in
 * sidebar order. Generic over the item type so callers keep their icons (or
 * anything else hanging off the item) on the way through.
 *
 * - The Overview link itself is dropped — a card linking to the page you're
 *   already on is noise.
 * - A group with no navigable children is dropped entirely; a child without a
 *   `to` is skipped (the sidebar can't link it either).
 */
export function buildAdminOverview<T extends AdminNavShape>(
  items: T[],
  options: { excludePaths?: string[] } = {}
): AdminOverview<T> {
  const excluded = new Set(options.excludePaths ?? ["/admin/overview"]);
  const sections: AdminOverviewSection<T>[] = [];
  const standalone: T[] = [];

  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const links = (item.children as T[]).filter((child) => child.to && !excluded.has(child.to));
      if (links.length > 0) sections.push({ group: item, links });
      continue;
    }
    if (item.to && !excluded.has(item.to)) standalone.push(item);
  }

  return { sections, standalone };
}

// Per-section accent classes for the Overview tiles, keyed by the sidebar
// group's label. A group with no entry falls back to the neutral navy tile
// rather than rendering unstyled, so adding a sidebar group never breaks the
// page — it just looks plain until an accent is added here.
export interface OverviewAccent {
  /** Icon chip. */
  chip: string;
  /** Tile while its section is open. */
  open: string;
  /** Tile hover state while closed. */
  hover: string;
  /** Focus ring. */
  ring: string;
}

const ACCENTS: Record<string, OverviewAccent> = {
  Roles: {
    chip: "bg-lime-100 text-lime-700",
    open: "border-lime-400 bg-lime-50/40",
    hover: "hover:border-lime-300 hover:bg-lime-50/40",
    ring: "focus:ring-lime-300",
  },
  Students: {
    chip: "bg-sky-100 text-sky-700",
    open: "border-sky-400 bg-sky-50/40",
    hover: "hover:border-sky-300 hover:bg-sky-50/40",
    ring: "focus:ring-sky-300",
  },
  Teachers: {
    chip: "bg-green-100 text-green-700",
    open: "border-green-400 bg-green-50/40",
    hover: "hover:border-green-300 hover:bg-green-50/40",
    ring: "focus:ring-green-300",
  },
  "Performance Coaches": {
    chip: "bg-orange-100 text-orange-700",
    open: "border-orange-400 bg-orange-50/40",
    hover: "hover:border-orange-300 hover:bg-orange-50/40",
    ring: "focus:ring-orange-300",
  },
  "College Counsellors": {
    chip: "bg-violet-100 text-violet-700",
    open: "border-violet-400 bg-violet-50/40",
    hover: "hover:border-violet-300 hover:bg-violet-50/40",
    ring: "focus:ring-violet-300",
  },
  Configuration: {
    chip: "bg-navy-100 text-navy-600",
    open: "border-navy-400 bg-navy-50/60",
    hover: "hover:border-navy-300 hover:bg-navy-50/60",
    ring: "focus:ring-navy-300",
  },
};

const NEUTRAL_ACCENT: OverviewAccent = {
  chip: "bg-navy-50 text-navy-600",
  open: "border-navy-400 bg-navy-50/60",
  hover: "hover:border-navy-300 hover:bg-navy-50/60",
  ring: "focus:ring-navy-300",
};

export function overviewAccent(label: string): OverviewAccent {
  return ACCENTS[label] ?? NEUTRAL_ACCENT;
}

/**
 * Every route the Overview page links to, sections first then standalones.
 * Used by the test that asserts Overview covers the whole sidebar.
 */
export function adminOverviewPaths<T extends AdminNavShape>(overview: AdminOverview<T>): string[] {
  return [
    ...overview.sections.flatMap((section) => section.links.map((link) => link.to as string)),
    ...overview.standalone.map((item) => item.to as string),
  ];
}

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

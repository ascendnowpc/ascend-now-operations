import { Link } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { ADMIN_NAV_ITEMS } from "./adminNav";
import { PageHeader } from "../../components/layout/PageHeader";
import { buildAdminOverview } from "../../utils/adminOverview";
import type { NavItem } from "../../components/layout/DashboardShell";

// Overview is the card version of the sidebar: it renders ADMIN_NAV_ITEMS
// itself, so a nav change shows up here without a second edit.
const { sections, standalone } = buildAdminOverview<NavItem>(ADMIN_NAV_ITEMS);

function LinkTile({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to!}
      className="flex items-center gap-3 rounded-xl border border-navy-100 bg-white px-4 py-3 transition-colors hover:border-lime-300 hover:bg-lime-50/40 focus:outline-none focus:ring-2 focus:ring-lime-300"
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-600">
        {item.icon}
      </span>
      <span className="min-w-0 text-sm font-semibold text-navy-700">{item.label}</span>
    </Link>
  );
}

export default function AdminOverviewPage() {
  return (
    <AdminLayout>
      <PageHeader title="Overview" />

      <div className="flex flex-col gap-5">
        {sections.map(({ group, links }) => (
          <section key={group.label}>
            <div className="mb-2 flex items-center gap-2 text-navy-600">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-navy-50 text-navy-600">
                {group.icon}
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide">{group.label}</h2>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {links.map((link) => (
                <LinkTile key={link.to} item={link} />
              ))}
            </div>
          </section>
        ))}

        {standalone.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {standalone.map((item) => (
              <LinkTile key={item.to} item={item} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

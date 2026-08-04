import { useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { ADMIN_NAV_ITEMS } from "./adminNav";
import { PageHeader } from "../../components/layout/PageHeader";
import { buildAdminOverview, overviewAccent } from "../../utils/adminOverview";
import type { NavItem } from "../../components/layout/DashboardShell";

// Overview is the card version of the sidebar: it renders ADMIN_NAV_ITEMS
// itself, so a nav change shows up here without a second edit. A sidebar group
// becomes a tile that opens to reveal its links; a standalone sidebar item
// becomes a tile that just navigates.
const { sections, standalone } = buildAdminOverview<NavItem>(ADMIN_NAV_ITEMS);

const tileClasses =
  "text-left bg-white rounded-2xl border shadow-sm p-5 transition-colors focus:outline-none focus:ring-2";

function TileInner({ item, chip }: { item: NavItem; chip: string }) {
  return (
    <>
      <span className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${chip}`}>
        {item.icon}
      </span>
      <p className="font-semibold text-navy-700 text-lg">{item.label}</p>
    </>
  );
}

export default function AdminOverviewPage() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openSection = sections.find((s) => s.group.label === openKey) ?? null;

  return (
    <AdminLayout>
      <PageHeader title="Overview" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map(({ group }) => {
          const open = group.label === openKey;
          const accent = overviewAccent(group.label);
          return (
            <button
              key={group.label}
              type="button"
              onClick={() => setOpenKey(open ? null : group.label)}
              aria-expanded={open}
              className={`${tileClasses} ${accent.ring} ${
                open ? accent.open : `border-navy-100 ${accent.hover}`
              }`}
            >
              <TileInner item={group} chip={accent.chip} />
            </button>
          );
        })}

        {standalone.map((item) => (
          <Link
            key={item.to}
            to={item.to!}
            className={`${tileClasses} border-navy-100 focus:ring-navy-300 hover:border-navy-300 hover:bg-navy-50/60`}
          >
            <TileInner item={item} chip="bg-navy-50 text-navy-600" />
          </Link>
        ))}
      </div>

      {openSection && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {openSection.links.map((link) => (
            <Link
              key={link.to}
              to={link.to!}
              className="flex items-center gap-3 rounded-xl border border-navy-100 bg-white p-4 transition-colors hover:border-lime-300 hover:bg-lime-50/40 focus:outline-none focus:ring-2 focus:ring-lime-300"
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-600">
                {link.icon}
              </span>
              <span className="min-w-0 text-sm font-semibold text-navy-700">{link.label}</span>
            </Link>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

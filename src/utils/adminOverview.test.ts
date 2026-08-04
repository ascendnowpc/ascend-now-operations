import { describe, it, expect } from "vitest";
import {
  buildAdminOverview,
  adminOverviewPaths,
  overviewAccent,
  type AdminNavShape,
} from "./adminOverview";
import { ADMIN_NAV_ITEMS } from "../pages/admin/adminNav";

const NAV: AdminNavShape[] = [
  { label: "Overview", to: "/admin/overview" },
  {
    label: "Roles",
    children: [
      { label: "Users", to: "/admin/users" },
      { label: "Admins", to: "/admin/admins" },
    ],
  },
  { label: "Reports", to: "/admin/reports" },
];

describe("buildAdminOverview", () => {
  it("turns every sidebar group into a section carrying its links in order", () => {
    const { sections } = buildAdminOverview(NAV);
    expect(sections).toHaveLength(1);
    expect(sections[0].group.label).toBe("Roles");
    expect(sections[0].links.map((l) => l.to)).toEqual(["/admin/users", "/admin/admins"]);
  });

  it("keeps standalone sidebar links as their own entries", () => {
    const { standalone } = buildAdminOverview(NAV);
    expect(standalone.map((i) => i.label)).toEqual(["Reports"]);
  });

  it("drops the Overview link itself — it points at the page showing the cards", () => {
    expect(adminOverviewPaths(buildAdminOverview(NAV))).not.toContain("/admin/overview");
  });

  it("honours a custom exclusion list instead of the default", () => {
    const paths = adminOverviewPaths(buildAdminOverview(NAV, { excludePaths: ["/admin/reports"] }));
    expect(paths).toContain("/admin/overview");
    expect(paths).not.toContain("/admin/reports");
  });

  it("skips a group whose children are all excluded rather than showing an empty card", () => {
    const nav: AdminNavShape[] = [{ label: "Roles", children: [{ label: "Users", to: "/admin/users" }] }];
    expect(buildAdminOverview(nav, { excludePaths: ["/admin/users"] }).sections).toEqual([]);
  });

  it("skips a group with an empty children array", () => {
    expect(buildAdminOverview([{ label: "Empty", children: [] }]).sections).toEqual([]);
  });

  it("skips a child that has no route, since the sidebar can't link it either", () => {
    const nav: AdminNavShape[] = [
      { label: "Roles", children: [{ label: "Users", to: "/admin/users" }, { label: "Placeholder" }] },
    ];
    expect(buildAdminOverview(nav).sections[0].links.map((l) => l.label)).toEqual(["Users"]);
  });

  it("ignores an item that is neither a group nor a link", () => {
    expect(buildAdminOverview([{ label: "Nothing" }])).toEqual({ sections: [], standalone: [] });
  });

  it("preserves sidebar order across sections and standalones", () => {
    expect(adminOverviewPaths(buildAdminOverview(NAV))).toEqual([
      "/admin/users",
      "/admin/admins",
      "/admin/reports",
    ]);
  });
});

describe("the real admin sidebar", () => {
  const overview = buildAdminOverview(ADMIN_NAV_ITEMS);

  it("gives Overview a card for every sidebar destination except Overview itself", () => {
    const navPaths = ADMIN_NAV_ITEMS.flatMap((item) =>
      item.children ? item.children.map((c) => c.to as string) : [item.to as string]
    ).filter((to) => to && to !== "/admin/overview");
    expect(adminOverviewPaths(overview).sort()).toEqual(navPaths.sort());
  });

  it("keeps the standalone sidebar items standalone on Overview", () => {
    expect(overview.standalone.map((i) => i.label)).toEqual([
      "Renewal Requests",
      "Reports",
      "Analysis",
      "Session Logs",
      "My Profile",
    ]);
  });

  it("keeps the sidebar's sections, in sidebar order", () => {
    expect(overview.sections.map((s) => s.group.label)).toEqual([
      "Roles",
      "Students",
      "Teachers",
      "Performance Coaches",
      "College Counsellors",
      "Configuration",
    ]);
  });
});

describe("overviewAccent", () => {
  it("gives each sidebar section its own accent", () => {
    expect(overviewAccent("Roles").chip).not.toBe(overviewAccent("Students").chip);
  });

  it("falls back to a neutral tile for a section with no accent defined", () => {
    const fallback = overviewAccent("A Brand New Section");
    expect(fallback.chip).toBeTruthy();
    expect(fallback.ring).toBeTruthy();
  });

  it("gives every real sidebar section a defined accent", () => {
    const neutral = overviewAccent("__no_such_section__");
    for (const { group } of buildAdminOverview(ADMIN_NAV_ITEMS).sections) {
      expect(overviewAccent(group.label)).not.toEqual(neutral);
    }
  });
});

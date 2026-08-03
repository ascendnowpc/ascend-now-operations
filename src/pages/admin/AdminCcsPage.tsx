import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { IconDownload, IconPlus } from "../../components/ui/icons";
import { useTeachers, useInactiveTeachers } from "../../hooks/useTeachers";
import { useUsers } from "../../hooks/useUsers";
import type { Teacher } from "../../types/database";
import { idSeqNumber } from "../../utils/entityId";

function exportCsv(ccs: Teacher[], usernameLookup: Map<string, string>) {
  const headers = ["ID", "First Name", "Last Name", "Username", "Email", "Phone", "Country", "Active"];
  const rows = ccs.map((t) => [
    String(t.id),
    t.first_name,
    t.last_name ?? "",
    t.user_id ? (usernameLookup.get(t.user_id) ?? "") : "",
    t.email ?? "",
    t.phone_number ?? "",
    t.country ?? "",
    t.is_active ? "Active" : "Inactive",
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "college-counsellors.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// The "CC" page — same underlying teachers list as /admin/teachers, filtered
// to college counsellors (is_college_counselor = true). Directly mirrors
// AdminPcsPage, including the row click: a CC now has a detail page of their
// own (/admin/ccs/:id) with their roster and the profile card their students
// see on My CC.
export default function AdminCcsPage() {
  const { teachers: rawTeachers, loading } = useTeachers();
  const { teachers: inactiveRaw, loading: inactiveLoading } = useInactiveTeachers();
  const { users } = useUsers();
  const navigate = useNavigate();

  const byId = (a: Teacher, b: Teacher) => idSeqNumber(a.id) - idSeqNumber(b.id);
  const activeCcs = rawTeachers.filter((t) => t.is_active && t.is_college_counselor).sort(byId);
  const inactiveCcs = inactiveRaw.filter((t) => t.is_college_counselor).sort(byId);

  const [tab, setTab] = useState<"active" | "deactivated">("active");
  const [search, setSearch] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  const usernameLookup = new Map(users.map((u) => [u.id, u.username]));
  const uniqueCountries = [...new Set([...activeCcs, ...inactiveCcs].map((t) => t.country).filter(Boolean) as string[])].sort();

  function applyFilters(list: Teacher[]) {
    return list.filter((t) => {
      const nameMatch = `${t.id} ${t.first_name} ${t.last_name ?? ""} ${t.email ?? ""}`.toLowerCase().includes(search.toLowerCase());
      const countryMatch = !filterCountry || t.country === filterCountry;
      return nameMatch && countryMatch;
    });
  }

  const filtered = applyFilters(activeCcs);
  const filteredInactive = applyFilters(inactiveCcs);

  const columns: ColumnDef<Teacher>[] = [
    { header: "ID", accessor: (t) => t.id },
    { header: "First name", accessor: (t) => t.first_name },
    { header: "Last name", accessor: (t) => t.last_name ?? "—" },
    { header: "Username", accessor: (t) => (t.user_id ? (usernameLookup.get(t.user_id) ?? "—") : "—") },
    { header: "Email", accessor: (t) => t.email ?? "—" },
    { header: "Phone", accessor: (t) => t.phone_number ?? "—" },
    { header: "Country", accessor: (t) => t.country ?? "—" },
    {
      header: "Status",
      accessor: (t) =>
        t.is_active ? (
          <span className="inline-block rounded-pill bg-lime-100 text-lime-600 px-3 py-0.5 text-xs font-semibold">
            Active
          </span>
        ) : (
          <span className="inline-block rounded-pill bg-navy-50 text-navy-300 px-3 py-0.5 text-xs font-semibold">
            Inactive
          </span>
        ),
    },
  ];

  const hasFilters = search || filterCountry;

  return (
    <AdminLayout>
      <PageHeader
        title="CC"
        description="College counsellors only — the teachers flagged as a College Counsellor."
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => exportCsv(filtered, usernameLookup)}
              className="flex items-center gap-2"
              disabled={filtered.length === 0}
            >
              <IconDownload /> Export CSV
            </Button>
            <Button onClick={() => navigate("/admin/teachers/new?cc=1")} className="flex items-center gap-2">
              <IconPlus /> Add CC
            </Button>
          </div>
        }
      />

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TextInput
            label="Search name / email / ID"
            placeholder="Name, email or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectInput
            label="Country"
            placeholder="All countries"
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            options={uniqueCountries.map((c) => ({ value: c, label: c }))}
          />
        </div>
        {hasFilters && (
          <button
            className="mt-2 text-sm text-sky-400 hover:underline"
            onClick={() => {
              setSearch("");
              setFilterCountry("");
            }}
          >
            Clear all filters
          </button>
        )}
      </Card>

      <div className="flex gap-2 mb-4">
        {(["active", "deactivated"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
              tab === t
                ? "bg-sky-500 border-sky-500 text-white"
                : "bg-white border-navy-100 text-navy-500 hover:border-sky-200"
            }`}
          >
            {t === "active" ? `Active (${filtered.length})` : `Deactivated (${filteredInactive.length})`}
          </button>
        ))}
      </div>

      {tab === "active" && (
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(t) => t.id}
          loading={loading}
          onRowClick={(t) => navigate(`/admin/ccs/${t.id}`)}
        />
      )}

      {tab === "deactivated" && (
        <DataTable
          columns={columns}
          rows={filteredInactive}
          getRowId={(t) => t.id}
          loading={inactiveLoading}
          onRowClick={(t) => navigate(`/admin/ccs/${t.id}`)}
        />
      )}
    </AdminLayout>
  );
}

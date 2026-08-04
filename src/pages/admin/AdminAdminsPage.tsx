import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { IconPlus } from "../../components/ui/icons";
import { useUsers } from "../../hooks/useUsers";
import { useAdmins } from "../../hooks/useAdmins";
import type { AppUser } from "../../types/database";

type AdminRow = AppUser & { admin_id: string | null; admin_phone: string | null; admin_country: string | null };

export default function AdminAdminsPage() {
  const { users, loading } = useUsers();
  const { admins: adminRecords } = useAdmins();
  const navigate = useNavigate();

  // admins.phone_number/country live on the admins table, not users — merge
  // by user_id onto the users-table rows below.
  // (`id` too — the mnemonic admins.id, e.g. ARIS26-2; AppUser.id is the
  // auth uuid, which is not the id shown anywhere else in the app.)
  const adminExtras: Record<string, { id: string; phone_number: string | null; country: string | null }> = {};
  for (const a of adminRecords) {
    adminExtras[a.user_id] = { id: a.id, phone_number: a.phone_number, country: a.country };
  }

  const admins: AdminRow[] = users
    .filter((u) => u.role === "admin")
    .map((u) => ({
      ...u,
      admin_id: adminExtras[u.id]?.id ?? null,
      admin_phone: adminExtras[u.id]?.phone_number ?? null,
      admin_country: adminExtras[u.id]?.country ?? null,
    }));

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");

  const q = search.trim().toLowerCase();
  const filteredAdmins = admins.filter((u) => {
    const matchesSearch =
      !q ||
      u.username.toLowerCase().includes(q) ||
      (u.full_name ?? "").toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
    const matchesStatus =
      !statusFilter || (statusFilter === "active" ? u.is_active : !u.is_active);
    return matchesSearch && matchesStatus;
  });

  const activeFilterCount = [statusFilter].filter(Boolean).length;
  function clearFilters() {
    setStatusFilter("");
  }

  // A create/edit on the form route redirects back here with its result.
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  // Editing an admin lives on its own route (AdminAdminFormPage), the same
  // way teachers are edited at /admin/teachers/:id/edit.
  function openEdit(admin: AdminRow) {
    navigate(`/admin/admins/${admin.id}/edit`);
  }

  const columns: ColumnDef<AdminRow>[] = [
    { header: "ID", accessor: (u) => u.admin_id ?? "—", className: "whitespace-nowrap" },
    { header: "Username", accessor: (u) => u.username },
    { header: "Full name", accessor: (u) => u.full_name ?? "—" },
    { header: "Email", accessor: (u) => u.email },
    { header: "Country", accessor: (u) => u.admin_country ?? "—" },
    { header: "Phone", accessor: (u) => u.admin_phone ?? "—", className: "whitespace-nowrap" },
    {
      header: "Status",
      accessor: (u) => (
        <span
          className={`inline-block rounded-pill px-3 py-0.5 text-xs font-semibold ${
            u.is_active ? "bg-lime-100 text-lime-600" : "bg-navy-50 text-navy-300"
          }`}
        >
          {u.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Admins"
        description="Everyone with admin access to the platform."
        action={
          <Button onClick={() => navigate("/admin/admins/new")} className="flex items-center gap-2">
            <IconPlus /> Add admin
          </Button>
        }
      />

      {notice && (
        <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <TextInput
              label="Search"
              placeholder="Search by username, name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | "active" | "inactive")}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="mt-3 text-sm text-navy-400 hover:text-red-500">
            Clear filters
          </button>
        )}
      </Card>

      <p className="text-xs text-navy-400 mb-2">{filteredAdmins.length} of {admins.length} admins</p>

      <DataTable columns={columns} rows={filteredAdmins} getRowId={(u) => u.id} loading={loading} onEdit={openEdit} />
    </AdminLayout>
  );
}

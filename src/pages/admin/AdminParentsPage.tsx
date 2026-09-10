import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { IconPlus } from "../../components/ui/icons";
import { useParents } from "../../hooks/useParents";
import { useStudents } from "../../hooks/useStudents";
import { childrenOf, parentMatchesSearch } from "../../utils/parentDirectory";
import type { Parent } from "../../types/database";

/**
 * Every parent/guardian account. Adding one lives on its own route
 * (/admin/parents/new), editing on /admin/parents/:id/edit — the same shape
 * as /admin/admins and /admin/teachers.
 *
 * Routed on `parents.id` (the mnemonic SARK26-1), unlike /admin/admins which
 * has to route on the auth user id: a parent row is linked to by that id from
 * `students.parent_id`, so it's the id everything else in the app already
 * refers to.
 */
export default function AdminParentsPage() {
  const { parents, loading } = useParents();
  const { students } = useStudents();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const q = search.trim();
  const filtered = parents.filter((p) => parentMatchesSearch(p, q));

  // A create/edit on the form route redirects back here with its result.
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  const columns: ColumnDef<Parent>[] = [
    { header: "ID", accessor: (p) => p.id, className: "whitespace-nowrap" },
    { header: "First name", accessor: (p) => p.first_name },
    { header: "Last name", accessor: (p) => p.last_name },
    { header: "Email", accessor: (p) => p.email ?? "—" },
    { header: "Phone", accessor: (p) => p.phone_number ?? "—", className: "whitespace-nowrap" },
    {
      header: "Children",
      accessor: (p) => {
        const kids = childrenOf(students, p.id);
        if (kids.length === 0) return "—";
        return (
          <span className="flex flex-wrap gap-1">
            {kids.map((s) => (
              <span
                key={s.id}
                className="inline-block rounded-pill bg-sky-50 border border-sky-100 px-2 py-0.5 text-xs font-medium text-sky-600"
              >
                {s.first_name} {s.last_name}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      header: "Status",
      accessor: (p) => (
        <span
          className={`inline-block rounded-pill px-3 py-0.5 text-xs font-semibold ${
            p.is_active ? "bg-lime-100 text-lime-600" : "bg-navy-50 text-navy-300"
          }`}
        >
          {p.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Parents"
        description="Household accounts. One parent can have several children."
        action={
          <Button onClick={() => navigate("/admin/parents/new")} className="flex items-center gap-2">
            <IconPlus /> Add parent
          </Button>
        }
      />

      {notice && (
        <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}

      <Card className="p-4 mb-6">
        <TextInput
          label="Search"
          placeholder="Search by ID, name, email or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Card>

      <p className="text-xs text-navy-400 mb-2">{filtered.length} of {parents.length} parents</p>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={(p) => p.id}
        loading={loading}
        onEdit={(p) => navigate(`/admin/parents/${p.id}/edit`)}
        emptyMessage="No parent accounts yet."
      />
    </AdminLayout>
  );
}

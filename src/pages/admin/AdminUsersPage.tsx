import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { IconDownload } from "../../components/ui/icons";
import { useUsers } from "../../hooks/useUsers";
import { useTeachers } from "../../hooks/useTeachers";
import type { AppUser, UserRole } from "../../types/database";

const ROLE_OPTIONS: { value: UserRole | ""; label: string }[] = [
  { value: "", label: "All roles" },
  { value: "admin", label: "Admin" },
  { value: "teacher", label: "Teacher" },
  { value: "performance_coach", label: "Performance Coach" },
  { value: "college_counselor", label: "College Counsellor" },
  { value: "student", label: "Student" },
];

function exportCsv(users: AppUser[]) {
  const headers = ["Username", "Full Name", "Email", "Role", "Status"];
  const rows = users.map((u) => [
    u.username,
    u.full_name ?? "",
    u.email,
    u.role.replace("_", " "),
    u.is_active ? "Active" : "Inactive",
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "users.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminUsersPage() {
  const { users, loading } = useUsers();
  const { teachers } = useTeachers();
  const pcUserIds = new Set(teachers.filter((t) => t.is_performance_coach && t.user_id).map((t) => t.user_id!));
  const ccUserIds = new Set(teachers.filter((t) => t.is_college_counselor && t.user_id).map((t) => t.user_id!));
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<UserRole | "">("");
  const [filterActive, setFilterActive] = useState<"" | "active" | "inactive">("");

  const filtered = users.filter((u) => {
    const haystack = `${u.full_name ?? ""} ${u.username} ${u.email}`.toLowerCase();
    const searchMatch = haystack.includes(search.toLowerCase());
    const roleMatch = !filterRole || u.role === filterRole;
    const activeMatch = !filterActive || (filterActive === "active" ? u.is_active : !u.is_active);
    return searchMatch && roleMatch && activeMatch;
  });

  const columns: ColumnDef<AppUser>[] = [
    { header: "Username", accessor: (u) => u.username },
    { header: "Full name", accessor: (u) => u.full_name ?? "—" },
    { header: "Email", accessor: (u) => u.email },
    {
      header: "Role",
      accessor: (u) => {
        // The teachers flag wins over users.role, which can only carry one
        // of the two for someone who is both — PC first, same as elsewhere.
        const isPC = pcUserIds.has(u.id) || u.role === "performance_coach";
        const isCC = ccUserIds.has(u.id) || u.role === "college_counselor";
        return (
          <span className="text-sm text-navy-700 capitalize">
            {isPC ? "Performance Coach" : isCC ? "College Counsellor" : u.role.replace("_", " ")}
          </span>
        );
      },
    },
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
        title="Users"
        description="Everyone who can log into the platform, across all roles."
        action={
          <Button
            variant="secondary"
            onClick={() => exportCsv(filtered)}
            className="flex items-center gap-2"
            disabled={filtered.length === 0}
          >
            <IconDownload /> Export CSV
          </Button>
        }
      />

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <TextInput
            label="Search"
            placeholder="Name, username, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectInput
            label="Role"
            placeholder="All roles"
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as UserRole | "")}
            options={ROLE_OPTIONS.filter((r) => r.value !== "").map((r) => ({ value: r.value, label: r.label }))}
          />
          <SelectInput
            label="Status"
            placeholder="All statuses"
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value as "" | "active" | "inactive")}
            options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
          />
        </div>
        {(search || filterRole || filterActive) && (
          <button
            className="mt-2 text-sm text-sky-400 hover:underline"
            onClick={() => { setSearch(""); setFilterRole(""); setFilterActive(""); }}
          >
            Clear filters
          </button>
        )}
      </Card>

      <DataTable columns={columns} rows={filtered} getRowId={(u) => u.id} loading={loading} />
    </AdminLayout>
  );
}

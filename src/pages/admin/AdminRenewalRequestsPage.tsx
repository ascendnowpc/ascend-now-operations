import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { SelectInput, TextInput } from "../../components/ui/Input";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Toast } from "../../components/ui/Toast";
import { useRenewalRequests, type PackageRenewalRequestWithCourseType } from "../../hooks/useRenewalRequests";
import { useTeachers } from "../../hooks/useTeachers";
import { useStudents } from "../../hooks/useStudents";
import { useAuth } from "../../context/AuthContext";
import type { PackageRenewalStatus } from "../../types/database";

const STATUS_LABEL: Record<PackageRenewalStatus, string> = {
  pending: "Awaiting Acknowledgement",
  acknowledged: "Acknowledged",
  renewed: "Renewed",
};

const STATUS_BADGE: Record<PackageRenewalStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  acknowledged: "bg-sky-100 text-sky-700",
  renewed: "bg-lime-100 text-lime-700",
};

export default function AdminRenewalRequestsPage() {
  const { profile } = useAuth();
  const { loading, fetchAll, acknowledge } = useRenewalRequests();
  const { teachers } = useTeachers();
  const { students } = useStudents();

  const [rows, setRows] = useState<PackageRenewalRequestWithCourseType[]>([]);
  const [statusFilter, setStatusFilter] = useState<PackageRenewalStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(null);

  async function load() {
    const data = await fetchAll();
    setRows(data);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function studentName(id: string) {
    const s = students.find((s) => s.id === id);
    return s ? `${s.id} — ${s.first_name} ${s.last_name}` : id;
  }

  // The requester is a coach or a counsellor — both file these now.
  function requesterName(id: string) {
    const t = teachers.find((t) => t.id === id);
    return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : `Teacher ${id}`;
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !studentName(r.student_id).toLowerCase().includes(q) && !requesterName(r.requested_by_teacher_id).toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, statusFilter, search, students, teachers]);

  async function handleAcknowledge(r: PackageRenewalRequestWithCourseType) {
    if (!profile) return;
    setBusyId(r.id);
    const { error } = await acknowledge(r.id, profile.id);
    setBusyId(null);
    if (error) { setToast({ message: error, variant: "error" }); return; }
    setToast({ message: `Acknowledged — ${requesterName(r.requested_by_teacher_id)} will see this as acknowledged.`, variant: "success" });
    load();
  }

  const columns: ColumnDef<PackageRenewalRequestWithCourseType>[] = [
    { header: "Student", accessor: (r) => studentName(r.student_id) },
    {
      header: "Package",
      accessor: (r) => (
        <div className="min-w-0">
          <p className="text-navy-700 font-medium">{r.course_types?.name ?? `Type ${r.course_type_id}`}</p>
          {(r.requested_hours != null || r.package_size_label) && (
            <p className="text-xs text-navy-300">{r.requested_hours != null ? `${r.requested_hours} hrs` : ""}{r.package_size_label ? `${r.requested_hours != null ? " — " : ""}${r.package_size_label}` : ""}</p>
          )}
        </div>
      ),
    },
    { header: "Requested by", accessor: (r) => requesterName(r.requested_by_teacher_id) },
    { header: "Note", accessor: (r) => <span className="max-w-[220px] truncate inline-block align-bottom">{r.note || <span className="text-navy-200 italic">—</span>}</span> },
    {
      header: "Status",
      accessor: (r) => <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>,
    },
    { header: "Requested", accessor: (r) => new Date(r.created_at).toLocaleDateString() },
    {
      header: "",
      className: "text-right",
      accessor: (r) =>
        r.status === "pending" ? (
          <Button size="xs" disabled={busyId === r.id} onClick={() => handleAcknowledge(r)}>
            {busyId === r.id ? "Working…" : "Acknowledge"}
          </Button>
        ) : null,
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Renewal Requests"
        description="Package renewals flagged by Performance Coaches and College Counsellors. Acknowledge a request, then process the actual renewal from Add / Renew Student — it's marked Renewed automatically once that package is added."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="p-4">
          <p className="text-xs text-navy-300">Awaiting acknowledgement</p>
          <p className="text-2xl font-bold text-amber-600">{loading ? "—" : counts.pending ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Acknowledged</p>
          <p className="text-2xl font-bold text-sky-600">{loading ? "—" : counts.acknowledged ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Renewed</p>
          <p className="text-2xl font-bold text-lime-600">{loading ? "—" : counts.renewed ?? 0}</p>
        </Card>
      </div>

      <Card className="p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextInput label="Search" placeholder="Student, coach or counsellor…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectInput
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PackageRenewalStatus | "all")}
            options={[
              { value: "all", label: "All" },
              { value: "pending", label: `Awaiting Acknowledgement${counts.pending ? ` (${counts.pending})` : ""}` },
              { value: "acknowledged", label: "Acknowledged" },
              { value: "renewed", label: "Renewed" },
            ]}
          />
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm py-8"><Spinner /> Loading…</div>
      ) : (
        <DataTable columns={columns} rows={filtered} getRowId={(r) => r.id} emptyMessage="No renewal requests for these filters." />
      )}

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </AdminLayout>
  );
}

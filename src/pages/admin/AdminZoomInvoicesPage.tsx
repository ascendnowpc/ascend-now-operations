import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { useAuth } from "../../context/AuthContext";
import { useZoomInvoices } from "../../hooks/useZoomInvoices";
import { useTeachers } from "../../hooks/useTeachers";
import type { ZoomInvoiceWithTeacher } from "../../types/database";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_OPTIONS = MONTH_NAMES.map((name, i) => ({
  value: String(i + 1).padStart(2, "0"),
  label: name,
}));

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

function teacherName(t: { first_name: string; last_name: string | null } | null) {
  return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : "—";
}

type StatusFilter = "pending" | "acknowledged" | "all";

const now = new Date();
const CURRENT_YEAR = String(now.getFullYear());
const CURRENT_MONTH = String(now.getMonth() + 1).padStart(2, "0");

const DEFAULT_STATUS: StatusFilter = "pending";

export default function AdminZoomInvoicesPage() {
  const { session } = useAuth();
  const { loading, fetchAllZoomInvoices, acknowledgeZoomInvoice, unacknowledgeZoomInvoice } = useZoomInvoices();
  const { teachers, loading: teachersLoading } = useTeachers();

  const [invoices, setInvoices] = useState<ZoomInvoiceWithTeacher[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS);
  // Default to the current month (the common case an admin wants on open);
  // "" = All years / All months once cleared/changed. KPIs and the table both
  // scope to whatever is picked here.
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR);
  const [monthFilter, setMonthFilter] = useState(CURRENT_MONTH);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    fetchAllZoomInvoices().then(setInvoices);
  }, [fetchAllZoomInvoices]);

  // Zoom invoices are a teacher-only obligation — performance coaches are
  // excluded from the "active" universe so the counts (and the "haven't
  // uploaded" list) never fold coaches in.
  const activeTeachers = useMemo(
    () => teachers.filter((t) => t.is_active && !t.is_performance_coach),
    [teachers]
  );

  const years = useMemo(() => {
    const fromInvoices = invoices.map((i) => i.period_month.slice(0, 4));
    return [...new Set([CURRENT_YEAR, ...fromInvoices])].sort((a, b) => (a < b ? 1 : -1));
  }, [invoices]);

  // Label for whatever Year/Month combo is currently selected.
  const periodScopeLabel = yearFilter && monthFilter
    ? monthLabel(`${yearFilter}-${monthFilter}`)
    : yearFilter
      ? yearFilter
      : monthFilter
        ? `${MONTH_NAMES[Number(monthFilter) - 1]} (all years)`
        : "All time";

  // The eligible universe for every count and the table: currently-active,
  // non-coach teachers. Anything outside it (a performance coach's stray
  // invoice, or a deactivated teacher's old row) is dropped so the KPI cards
  // reconcile — "haven't uploaded" + "uploaded" always equals "active
  // teachers" for a single month.
  const eligibleTeacherIds = useMemo(() => new Set(activeTeachers.map((t) => t.id)), [activeTeachers]);

  // Invoices within the selected Year/Month scope AND the eligible universe —
  // independent of the Status filter/search below, so the KPI cards always
  // reflect exactly the period the admin has picked.
  const invoicesInScope = useMemo(
    () => invoices.filter((i) => {
      if (!eligibleTeacherIds.has(i.teacher_id)) return false;
      if (yearFilter && i.period_month.slice(0, 4) !== yearFilter) return false;
      if (monthFilter && i.period_month.slice(5, 7) !== monthFilter) return false;
      return true;
    }),
    [invoices, eligibleTeacherIds, yearFilter, monthFilter]
  );
  const uploadedTeacherIds = useMemo(
    () => new Set(invoicesInScope.map((i) => i.teacher_id)),
    [invoicesInScope]
  );
  const missingCount = activeTeachers.filter((t) => !uploadedTeacherIds.has(t.id)).length;
  const pendingScopeCount = invoicesInScope.filter((i) => i.status === "pending").length;
  const acknowledgedScopeCount = invoicesInScope.filter((i) => i.status === "acknowledged").length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoicesInScope
      .filter((inv) => {
        if (statusFilter !== "all" && inv.status !== statusFilter) return false;
        if (q && !teacherName(inv.teachers).toLowerCase().includes(q) && !String(inv.teacher_id).includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const nameCompare = teacherName(a.teachers).localeCompare(teacherName(b.teachers));
        return nameCompare !== 0 ? nameCompare : (a.period_month < b.period_month ? 1 : -1);
      });
  }, [invoicesInScope, statusFilter, search]);

  const totalPendingCount = useMemo(
    () => invoices.filter((i) => i.status === "pending" && eligibleTeacherIds.has(i.teacher_id)).length,
    [invoices, eligibleTeacherIds]
  );

  const hasFilters = Boolean(
    search || statusFilter !== DEFAULT_STATUS || yearFilter !== CURRENT_YEAR || monthFilter !== CURRENT_MONTH
  );
  function clearFilters() {
    setSearch("");
    setStatusFilter(DEFAULT_STATUS);
    setYearFilter(CURRENT_YEAR);
    setMonthFilter(CURRENT_MONTH);
  }

  async function handleAcknowledge(inv: ZoomInvoiceWithTeacher) {
    if (!session?.user) return;
    setBusyId(inv.id);
    const { error } = await acknowledgeZoomInvoice(inv.id, session.user.id);
    setBusyId(null);
    if (!error) {
      setInvoices((prev) => prev.map((i) =>
        i.id === inv.id
          ? { ...i, status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by_user_id: session.user.id }
          : i
      ));
    }
  }

  async function handleUnacknowledge(inv: ZoomInvoiceWithTeacher) {
    setBusyId(inv.id);
    const { error } = await unacknowledgeZoomInvoice(inv.id);
    setBusyId(null);
    if (!error) {
      setInvoices((prev) => prev.map((i) =>
        i.id === inv.id ? { ...i, status: "pending", acknowledged_at: null, acknowledged_by_user_id: null } : i
      ));
    }
  }

  const columns: ColumnDef<ZoomInvoiceWithTeacher>[] = [
    {
      header: "ID",
      accessor: (inv) => <span className="text-navy-400">{inv.teacher_id}</span>,
    },
    {
      header: "Teacher",
      accessor: (inv) => (
        <div className="min-w-0">
          <p className="font-medium text-navy-700 truncate">{teacherName(inv.teachers)}</p>
        </div>
      ),
    },
    {
      header: "Role",
      accessor: (inv) =>
        inv.teachers?.is_performance_coach ? (
          <span className="inline-block rounded-pill bg-sky-50 text-sky-600 px-2.5 py-0.5 text-xs font-semibold">PC</span>
        ) : (
          <span className="text-navy-300 text-xs">Teacher</span>
        ),
    },
    { header: "Period", accessor: (inv) => monthLabel(inv.period_month.slice(0, 7)) },
    {
      header: "File",
      accessor: (inv) => (
        <a href={inv.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sky-600 hover:underline whitespace-nowrap">
          <span>📄</span> View
        </a>
      ),
    },
    {
      header: "Status",
      accessor: (inv) => (
        <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${
          inv.status === "acknowledged" ? "bg-lime-100 text-lime-600" : "bg-amber-100 text-amber-700"
        }`}>
          {inv.status === "acknowledged" ? "Acknowledged" : "Pending"}
        </span>
      ),
    },
    {
      header: "Action",
      className: "text-right",
      accessor: (inv) =>
        inv.status === "acknowledged" ? (
          <Button size="xs" variant="ghost" disabled={busyId === inv.id} onClick={() => handleUnacknowledge(inv)}>
            {busyId === inv.id ? "Saving…" : "Undo"}
          </Button>
        ) : (
          <Button size="xs" disabled={busyId === inv.id} onClick={() => handleAcknowledge(inv)}>
            {busyId === inv.id ? "Saving…" : "Acknowledge"}
          </Button>
        ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Zoom Invoices"
        description="Monthly Zoom Invoice receipts uploaded by teachers. Acknowledge once payment has been confirmed."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="p-4">
          <p className="text-xs text-navy-300">Active teachers</p>
          <p className="text-2xl font-bold text-navy-700">{teachersLoading ? "—" : activeTeachers.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Haven't uploaded — {periodScopeLabel}</p>
          <p className="text-2xl font-bold text-red-500">{loading || teachersLoading ? "—" : missingCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Pending acknowledgement — {periodScopeLabel}</p>
          <p className="text-2xl font-bold text-amber-600">{loading ? "—" : pendingScopeCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Acknowledged — {periodScopeLabel}</p>
          <p className="text-2xl font-bold text-lime-600">{loading ? "—" : acknowledgedScopeCount}</p>
        </Card>
      </div>

      <Card className="p-4 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <TextInput
            label="Search teacher"
            placeholder="Name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectInput
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            options={[
              { value: "pending", label: `Pending${totalPendingCount > 0 ? ` (${totalPendingCount})` : ""}` },
              { value: "acknowledged", label: "Acknowledged" },
              { value: "all", label: "All" },
            ]}
          />
          <SelectInput
            label="Year"
            placeholder="All years"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            options={years.map((y) => ({ value: y, label: y }))}
          />
          <SelectInput
            label="Month"
            placeholder="All months"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            options={MONTH_OPTIONS}
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 text-sm text-sky-400 hover:underline"
          >
            Clear all filters
          </button>
        )}
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm py-8"><Spinner /> Loading…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(inv) => inv.id}
          emptyMessage="No Zoom Invoices found for these filters."
        />
      )}
    </AdminLayout>
  );
}

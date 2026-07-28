import { useEffect, useMemo, useState } from "react";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { InvoiceFilePreview } from "../../components/ui/InvoiceFilePreview";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useAuth } from "../../context/AuthContext";
import { useZoomInvoices } from "../../hooks/useZoomInvoices";
import type { ZoomInvoice } from "../../types/database";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

export default function TeacherInvoicesPage() {
  const { teacher } = useMyTeacherProfile();
  const { session } = useAuth();
  const { loading, fetchMyZoomInvoices, upsertZoomInvoice } = useZoomInvoices();

  const [invoices, setInvoices] = useState<ZoomInvoice[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!teacher) return;
    fetchMyZoomInvoices(teacher.id).then(setInvoices);
  }, [teacher, fetchMyZoomInvoices]);

  const byMonth = useMemo(
    () => new Map(invoices.map((inv) => [inv.period_month.slice(0, 7), inv])),
    [invoices]
  );
  const currentForSelectedMonth = byMonth.get(selectedMonth) ?? null;
  const isLockedForUpload = currentForSelectedMonth?.status === "acknowledged";

  const historyMonths = useMemo(
    () => [...byMonth.keys()].sort((a, b) => (a < b ? 1 : -1)),
    [byMonth]
  );

  async function handleUpload() {
    if (!teacher || !session?.user || !file) return;
    setUploading(true);
    setUploadError(null);
    const { data, error } = await upsertZoomInvoice({
      teacherId: teacher.id,
      periodMonth: `${selectedMonth}-01`,
      file,
      uploadedByUserId: session.user.id,
    });
    setUploading(false);
    if (error) { setUploadError(error); return; }
    if (data) {
      setInvoices((prev) => [data, ...prev.filter((i) => i.id !== data.id)]);
      setFile(null);
    }
  }

  // Zoom invoices are a teacher-only obligation. The sidebar already hides
  // this page from performance coaches; guard the page itself too, so a coach
  // reaching /teacher/invoices directly can't use the upload form (the DB RLS
  // blocks the write regardless, but this avoids a confusing failed attempt).
  if (teacher?.is_performance_coach) {
    return (
      <TeacherLayout>
        <PageHeader
          title="Invoices"
          description="Zoom Invoices are for teachers only."
        />
        <Card className="p-8 text-center max-w-xl">
          <p className="text-3xl mb-2">🧾</p>
          <p className="text-sm font-medium text-navy-600">
            Zoom Invoices don't apply to performance coaches.
          </p>
        </Card>
      </TeacherLayout>
    );
  }

  return (
    <TeacherLayout>
      <PageHeader
        title="Invoices"
        description="Upload your Zoom Invoice — the payment receipt for the month — for admin to review and acknowledge."
      />

      <Card className="p-6 max-w-xl mb-6">
        <h2 className="text-sm font-semibold text-navy-700 mb-3">Upload for a month</h2>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-navy-500">Month</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); setFile(null); setUploadError(null); }}
              className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300 max-w-[200px]"
            />
          </div>

          {currentForSelectedMonth && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${
                currentForSelectedMonth.status === "acknowledged" ? "bg-lime-100 text-lime-600" : "bg-amber-100 text-amber-700"
              }`}>
                {currentForSelectedMonth.status === "acknowledged" ? "Acknowledged" : "Pending review"}
              </span>
              <InvoiceFilePreview url={currentForSelectedMonth.file_url} className="max-w-[220px]" />
            </div>
          )}

          {isLockedForUpload ? (
            <p className="text-xs text-navy-400">
              This month's invoice has already been acknowledged and can't be replaced. Contact an admin if it needs a correction.
            </p>
          ) : (
            <>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm text-navy-700"
              />
              {uploadError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{uploadError}</p>
              )}
              <div>
                <Button type="button" onClick={handleUpload} disabled={!file || uploading}>
                  {uploading ? "Uploading…" : currentForSelectedMonth ? "Replace invoice" : "Upload invoice"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <h2 className="text-sm font-bold uppercase tracking-wider text-navy-400 mb-3">History</h2>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm py-8"><Spinner /> Loading…</div>
      ) : historyMonths.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-3xl mb-2">🧾</p>
          <p className="text-sm font-medium text-navy-600">No Zoom Invoices uploaded yet.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {historyMonths.map((key) => {
            const inv = byMonth.get(key)!;
            return (
              <Card key={key} className="p-4 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-navy-700">{monthLabel(key)}</p>
                  <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${
                    inv.status === "acknowledged" ? "bg-lime-100 text-lime-600" : "bg-amber-100 text-amber-700"
                  }`}>
                    {inv.status === "acknowledged" ? "Acknowledged" : "Pending"}
                  </span>
                </div>
                <InvoiceFilePreview url={inv.file_url} />
              </Card>
            );
          })}
        </div>
      )}
    </TeacherLayout>
  );
}

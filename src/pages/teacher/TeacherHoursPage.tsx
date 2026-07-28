import { useEffect, useState, useCallback } from "react";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { fetchTeacherPeriodDetail, subjLabel, isPayableNoShow, type TeacherPeriodDetail } from "../../utils/teacherPeriodDetail";
import { useNoShowSettings } from "../../hooks/useNoShowSettings";
import { buildTeacherInvoicePdf } from "../../utils/buildInvoicePdf";

function formatMonth(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TeacherHoursPage() {
  const now = new Date();
  const { teacher, loading: teacherLoading } = useMyTeacherProfile();
  const { settings: noShowSettings } = useNoShowSettings();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<TeacherPeriodDetail | null>(null);
  const [downloading, setDownloading] = useState<"invoice" | "logs" | null>(null);

  const payoutRate = noShowSettings?.payout_amount ?? 30;
  const payoutCurrency = noShowSettings?.currency ?? "SGD";
  const payableNoShowCount = detail ? detail.noShows.filter((n) => isPayableNoShow(n.noShowType)).length : 0;
  const noShowPayout = payableNoShowCount * payoutRate;

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const load = useCallback(async () => {
    if (!teacher) return;
    setLoading(true);
    const d = await fetchTeacherPeriodDetail(teacher.id, year, month);
    setDetail(d);
    setLoading(false);
  }, [teacher, year, month]);

  useEffect(() => { load(); }, [load]);

  function handleDownloadInvoice() {
    if (!teacher || !detail) return;
    setDownloading("invoice");
    setTimeout(() => {
      buildTeacherInvoicePdf({
        teacher: {
          id: teacher.id,
          name: `${teacher.first_name} ${teacher.last_name ?? ""}`.trim(),
          email: teacher.email,
          phone: teacher.phone_number,
          country: teacher.country,
          subjectsTaught: detail.subjectsTaught,
        },
        periodStart: detail.periodStart,
        periodEnd: detail.periodEnd,
        totalHours: detail.totalHours,
        totalSessions: detail.totalSessions,
        breakdown: detail.breakdown,
        noShows: detail.noShows,
      });
      setDownloading(null);
    }, 0);
  }

  function handleDownloadSessionLogs() {
    if (!detail) return;
    setDownloading("logs");
    setTimeout(() => {
      const rows = [
        ["Date", "Student", "Subject", "Curriculum", "Program", "Duration (hrs)", "Status", "Topic"],
        ...detail.sessions.map((s) => [
          new Date(s.date).toLocaleDateString("en-GB"),
          s.studentName,
          subjLabel(s.subjectName, s.subjectLevel),
          s.curriculumName ?? "",
          s.programTypeName ?? "",
          s.hours != null ? s.hours.toFixed(2) : "",
          s.noShowLabel ?? "Completed",
          s.topic ?? "",
        ]),
      ];
      exportCSV(rows, `session-logs_${year}-${String(month).padStart(2, "0")}.csv`);
      setDownloading(null);
    }, 0);
  }

  return (
    <TeacherLayout>
      <PageHeader
        title="My Hours"
        description="Your own session hours for any month. Read-only — contact admin for corrections."
      />

      {/* Period selector */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          {months.map((m) => (
            <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" })}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="text-sm text-navy-500 font-medium">{formatMonth(year, month)}</span>
      </div>

      {teacherLoading || loading || !detail ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* Subjects taught intentionally not shown here — still included in
              the downloadable report/PDF below (see handleDownloadInvoice). */}

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3 max-w-2xl">
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-navy-700">{detail.totalHours.toFixed(1)}</p>
              <p className="text-xs text-sky-500 font-semibold mt-0.5">Hours</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-navy-700">{detail.totalSessions}</p>
              <p className="text-xs text-sky-500 font-semibold mt-0.5">Sessions</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-navy-700">{detail.noShows.length}</p>
              <p className="text-xs text-amber-600 font-semibold mt-0.5">No-shows</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-navy-700">{noShowPayout.toFixed(2)}</p>
              <p className="text-xs text-amber-600 font-semibold mt-0.5">No-show payout ({payoutCurrency})</p>
            </Card>
          </div>

          {/* Breakdown by subject & program */}
          <Card>
            <div className="px-5 py-4 border-b border-navy-50">
              <p className="font-semibold text-navy-700">Breakdown by Subject &amp; Program</p>
            </div>
            {detail.breakdown.length === 0 ? (
              <p className="px-5 py-4 text-sm text-navy-400">No sessions logged for {formatMonth(year, month)}.</p>
            ) : (
              <div className="divide-y divide-navy-50">
                <div className="grid grid-cols-5 px-5 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide">
                  <span className="col-span-2">Subject</span>
                  <span>Program</span>
                  <span className="text-center">Sessions</span>
                  <span className="text-right">Hours</span>
                </div>
                {detail.breakdown.map((b, i) => (
                  <div key={i} className="grid grid-cols-5 px-5 py-3 hover:bg-navy-50">
                    <span className="col-span-2 text-sm font-medium text-navy-700">
                      {subjLabel(b.subjectName, b.subjectLevel)}{b.curriculumName ? ` · ${b.curriculumName}` : ""}
                    </span>
                    <span className="text-sm text-navy-600">{b.programTypeName ?? "—"}</span>
                    <span className="text-sm text-navy-600 text-center">{b.sessions}</span>
                    <span className="text-sm font-bold text-navy-700 text-right">{b.hours.toFixed(1)} hrs</span>
                  </div>
                ))}
                <div className="grid grid-cols-5 px-5 py-3 bg-navy-50">
                  <span className="col-span-2 text-sm font-bold text-navy-700">Total</span>
                  <span />
                  <span className="text-sm font-bold text-navy-700 text-center">{detail.totalSessions}</span>
                  <span className="text-sm font-bold text-sky-600 text-right">{detail.totalHours.toFixed(1)} hrs</span>
                </div>
              </div>
            )}
          </Card>

          {/* No-shows */}
          <Card>
            <div className="px-5 py-4 border-b border-navy-50">
              <p className="font-semibold text-navy-700">No-Show Sessions</p>
            </div>
            {detail.noShows.length === 0 ? (
              <p className="px-5 py-4 text-sm text-navy-400">No no-shows this period.</p>
            ) : (
              <div className="divide-y divide-navy-50">
                <div className="grid grid-cols-5 px-5 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide bg-amber-50/60">
                  <span>Date</span><span>Student</span><span>Subject</span><span>Type</span><span className="text-right">Payout</span>
                </div>
                {detail.noShows.map((n, i) => (
                  <div key={i} className="grid grid-cols-5 px-5 py-2.5 text-sm items-center">
                    <span className="text-navy-600">{new Date(n.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                    <span className="text-navy-700 font-medium">{n.studentName}</span>
                    <span className="text-navy-600">{subjLabel(n.subjectName, n.subjectLevel)}</span>
                    <span>
                      <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-semibold">
                        {n.noShowLabel}
                      </span>
                    </span>
                    <span className="text-right text-navy-600">
                      {isPayableNoShow(n.noShowType) ? `${payoutRate.toFixed(2)} ${payoutCurrency}` : <span className="text-navy-300">—</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Downloads */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={handleDownloadInvoice} disabled={downloading !== null}>
              {downloading === "invoice" ? "Preparing…" : "Download Hours (PDF)"}
            </Button>
            <Button size="sm" variant="secondary" onClick={handleDownloadSessionLogs} disabled={downloading !== null}>
              {downloading === "logs" ? "Preparing…" : "Download Session Logs (CSV)"}
            </Button>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}

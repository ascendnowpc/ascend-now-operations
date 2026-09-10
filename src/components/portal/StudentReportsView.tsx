import { useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { ReportSectionsView } from "../ui/ReportSectionsView";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useStudentPackages } from "../../hooks/useStudentPackages";
import { useInvoices, type InvoiceWithItems } from "../../hooks/useInvoices";
import type { Student, StudentPackage } from "../../types/database";
import { buildSingleInvoicePdf, type PackageMeta } from "../../utils/buildInvoicePdf";
import { formatHours } from "../../utils/formatHours";

// Read-only reports view for a single student. Shows exactly the reports the
// admin/PC generated — same sectioned course-type / bundle-pool → subject →
// teacher format (ReportSectionsView) and the same downloadable PDF — with no
// generate / lock / delete actions.
export function StudentReportsView({ student }: { student: Student }) {
  const { courseTypes } = useCourseTypes();
  const { fetchPackagesForStudent } = useStudentPackages();
  const { fetchInvoicesForStudent, buildInvoiceSections } = useInvoices();

  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [packages, setPackages] = useState<StudentPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [invs, pkgs] = await Promise.all([fetchInvoicesForStudent(student.id), fetchPackagesForStudent(student.id, student.parent_id)]);
      if (cancelled) return;
      // RLS already hides unpublished reports from the student; this is a
      // second guard so a draft can never surface here.
      setInvoices(invs.filter((inv) => inv.published_to_student_at != null));
      setPackages(pkgs);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [student.id, fetchInvoicesForStudent, fetchPackagesForStudent]);

  const packageMetaById = new Map<number, PackageMeta>(
    packages.map((p) => [p.id, { course_type_id: p.course_type_id, package_type_id: p.package_type_id, pool_label: p.pool_label }])
  );
  const courseTypeNameById = (id: number | null) =>
    (id != null ? courseTypes.find((c) => c.id === id)?.name : undefined) ?? (id != null ? `Type ${id}` : "Other");
  const sectionsFor = (inv: InvoiceWithItems) => buildInvoiceSections(inv.invoice_line_items, packageMetaById, courseTypeNameById);

  function invoicePackageNames(inv: InvoiceWithItems) {
    const names = inv.invoice_packages.map((ip) => {
      const pkg = packages.find((p) => p.id === ip.student_package_id);
      if (!pkg) return `Package ${ip.student_package_id}`;
      if (pkg.package_type_id != null) return courseTypes.find((c) => c.id === pkg.package_type_id)?.name ?? "Bundle";
      return courseTypes.find((c) => c.id === pkg.course_type_id)?.name ?? `Type ${pkg.course_type_id}`;
    });
    return Array.from(new Set(names));
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  function handleDownload(inv: InvoiceWithItems) {
    buildSingleInvoicePdf({
      student,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      totalHours: inv.total_hours,
      sections: sectionsFor(inv),
    });
  }

  return (
    <Card className="p-5">
      <p className="font-semibold text-navy-700 mb-4">Reports</p>
      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-navy-400">No reports have been shared yet.</p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const isOpen = expanded.has(inv.id);
            return (
              <div key={inv.id} className="border border-navy-100 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-white text-sm flex-wrap gap-2">
                  <div>
                    <span className="font-medium text-navy-700">{fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}</span>
                    <span className="ml-3 text-navy-500">{formatHours(inv.total_hours)} hrs</span>
                    {inv.invoice_packages.length > 0 && (() => {
                      const names = invoicePackageNames(inv);
                      return <span className="ml-3 text-xs text-navy-400">Package{names.length !== 1 ? "s" : ""}: {names.join(", ")}</span>;
                    })()}
                  </div>
                  <div className="flex items-center gap-3">
                    {inv.status === "locked" && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-navy-600 text-white">🔒 final</span>}
                    <button onClick={() => handleDownload(inv)} className="text-xs text-sky-500 hover:text-sky-700">Download report</button>
                    {inv.invoice_line_items.length > 0 && (
                      <button
                        onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(inv.id)) n.delete(inv.id); else n.add(inv.id); return n; })}
                        className="text-xs text-navy-400 hover:text-navy-600"
                      >
                        {isOpen ? "▲" : "▼"} {inv.invoice_line_items.length} line{inv.invoice_line_items.length !== 1 ? "s" : ""}
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-navy-50 bg-navy-50 px-4 py-3">
                    <ReportSectionsView sections={sectionsFor(inv)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

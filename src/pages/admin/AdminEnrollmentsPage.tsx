import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { SelectInput, TextInput } from "../../components/ui/Input";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { RowMenu, type RowMenuAction } from "../../components/ui/RowMenu";
import { Toast } from "../../components/ui/Toast";
import { IconPlus } from "../../components/ui/icons";
import { useEnrollmentRequests, type EnrollmentRequestWithDetails } from "../../hooks/useEnrollmentRequests";
import { useTeachers } from "../../hooks/useTeachers";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { buildEnrollmentInvoicePdf } from "../../utils/buildInvoicePdf";
import { invalidateCachePrefix } from "../../lib/cache";
import type { EnrollmentStatus } from "../../types/database";

const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending_payment: "Awaiting Payment",
  payment_submitted: "Awaiting Review",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

const STATUS_BADGE: Record<EnrollmentStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-700",
  payment_submitted: "bg-sky-100 text-sky-700",
  confirmed: "bg-lime-100 text-lime-700",
  rejected: "bg-red-100 text-red-700",
};

function fullName(e: EnrollmentRequestWithDetails) {
  return `${e.first_name} ${e.last_name}`.trim();
}

function packageLabel(p: EnrollmentRequestWithDetails["packages"][number]) {
  return p.course_types?.name ?? `Type ${p.course_type_id}`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-navy-50 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">{label}</dt>
      <dd className="mt-0.5 text-navy-700 text-sm">{value}</dd>
    </div>
  );
}

const DEFAULT_REJECTION_NOTE = "We couldn't verify this payment screenshot.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string) {
  return EMAIL_RE.test(v.trim());
}

const emptyEditForm = {
  first_name: "",
  last_name: "",
  parent_first_name: "",
  parent_last_name: "",
  // The "send updates to" address — optional, falls back to student_email
  // when left blank (enrollment_requests.email is NOT NULL, so the actual
  // saved value always resolves to one or the other).
  notification_email: "",
  student_email: "",
  phone_number: "",
  address: "",
  country: "",
  note: "",
};

export default function AdminEnrollmentsPage() {
  const navigate = useNavigate();
  const {
    loading, fetchAll, sendInvoiceEmail, reviewPayment, getProofSignedUrl,
    updateEnrollmentRequest, deleteEnrollmentRequest,
  } = useEnrollmentRequests();
  const { teachers } = useTeachers();
  const { getPcForStudent } = usePcAssignments();

  const [rows, setRows] = useState<EnrollmentRequestWithDetails[]>([]);
  const [statusFilter, setStatusFilter] = useState<EnrollmentStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<EnrollmentRequestWithDetails | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EnrollmentRequestWithDetails | null>(null);
  const [rejectNote, setRejectNote] = useState(DEFAULT_REJECTION_NOTE);
  const [deleteTarget, setDeleteTarget] = useState<EnrollmentRequestWithDetails | null>(null);
  const [viewTarget, setViewTarget] = useState<EnrollmentRequestWithDetails | null>(null);
  const [editTarget, setEditTarget] = useState<EnrollmentRequestWithDetails | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function teacherName(id: string | null) {
    const t = teachers.find((t) => t.id === id);
    return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : "Unassigned";
  }

  // For a new-student request, the coordinator was picked on the form
  // (pc_teacher_id). For a renewal, the student already has one — look up
  // their current active Performance Coach assignment instead.
  function coordinatorNameFor(e: EnrollmentRequestWithDetails) {
    return e.enrollment_type === "new_student"
      ? teacherName(e.pc_teacher_id)
      : teacherName(e.student_id ? getPcForStudent(e.student_id) : null);
  }

  async function load() {
    const data = await fetchAll();
    setRows(data);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !fullName(r).toLowerCase().includes(q) && !r.email.toLowerCase().includes(q) && !(r.student_id ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, statusFilter, search]);

  async function handleViewProof(path: string) {
    const { url, error } = await getProofSignedUrl(path);
    if (error || !url) { setActionError(error ?? "Could not load screenshot"); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function doConfirm() {
    const e = confirmTarget;
    if (!e) return;
    setConfirmTarget(null);
    setBusyId(e.id);
    setActionError(null);
    setActionSuccess(null);
    const { error } = await reviewPayment({ enrollmentRequestId: e.id, action: "confirm" });
    setBusyId(null);
    if (error) { setActionError(error); return; }
    // A new_student confirm creates the students row server-side (via the
    // edge function's service-role client), which the Students page's
    // client-side cache (src/lib/cache.ts, 60s TTL) has no way to know
    // about — without this, a freshly confirmed student wouldn't show up
    // there until the cache expired on its own.
    if (e.enrollment_type === "new_student") invalidateCachePrefix("students:");
    setActionSuccess(`Confirmed — a confirmation email (${e.enrollment_type === "new_student" ? "with login credentials" : "no new login needed"}) was sent to ${e.email}.`);
    load();
  }

  function openRejectDialog(e: EnrollmentRequestWithDetails) {
    setRejectNote(DEFAULT_REJECTION_NOTE);
    setRejectTarget(e);
  }

  async function doReject() {
    const e = rejectTarget;
    if (!e) return;
    setRejectTarget(null);
    setBusyId(e.id);
    setActionError(null);
    setActionSuccess(null);
    const { error } = await reviewPayment({ enrollmentRequestId: e.id, action: "reject", rejectionReason: rejectNote.trim() || DEFAULT_REJECTION_NOTE });
    setBusyId(null);
    if (error) { setActionError(error); return; }
    setActionSuccess(`Rejected — an email was sent to ${e.email} explaining why, with a link to re-upload.`);
    load();
  }

  async function handleResendRejection(e: EnrollmentRequestWithDetails) {
    setBusyId(e.id);
    setActionError(null);
    setActionSuccess(null);
    const { error } = await reviewPayment({ enrollmentRequestId: e.id, action: "resend_rejection" });
    setBusyId(null);
    if (error) { setActionError(error); return; }
    setActionSuccess(`Rejection email resent to ${e.email}.`);
  }

  async function handleResend(e: EnrollmentRequestWithDetails) {
    setBusyId(e.id);
    setActionError(null);
    setActionSuccess(null);
    const coordinatorName = coordinatorNameFor(e);
    const pdfDoc = buildEnrollmentInvoicePdf({
      kindLabel: e.enrollment_type === "new_student" ? "New Enrollment" : "Package Renewal",
      parentFullName: e.parent_full_name,
      phoneNumber: e.phone_number,
      email: e.email,
      learnerName: fullName(e),
      address: e.address,
      country: e.country,
      packages: e.packages.map((p) => ({
        courseTypeName: packageLabel(p),
        packageSizeLabel: p.package_size_label,
        hours: p.hours,
      })),
      coordinatorName,
      note: e.note,
    });
    const invoicePdfBase64 = pdfDoc.output("datauristring").split(",")[1];
    const { error } = await sendInvoiceEmail({ enrollmentRequestId: e.id, coordinatorName, invoicePdfBase64 });
    setBusyId(null);
    if (error) { setActionError(error); return; }
    setActionSuccess(`Invoice email sent to ${e.email}.`);
  }

  // Editing and deleting are only offered for "Awaiting Payment" rows — once
  // a screenshot has been uploaded (or the request reviewed), the queue is
  // the audit trail and should stop changing underneath the reviewer.
  // Packages aren't editable here at all (same as course type never was) —
  // delete and re-create the request instead.
  function openEditDialog(e: EnrollmentRequestWithDetails) {
    setEditError(null);
    const [pFirst, ...pRest] = (e.parent_full_name ?? "").trim().split(/\s+/);
    setEditForm({
      first_name: e.first_name,
      last_name: e.last_name,
      parent_first_name: e.parent_full_name ? (pFirst ?? "") : "",
      parent_last_name: pRest.join(" "),
      notification_email: e.notification_email ?? "",
      student_email: e.student_email ?? "",
      phone_number: e.phone_number ?? "",
      address: e.address ?? "",
      country: e.country ?? "",
      note: e.note ?? "",
    });
    setEditTarget(e);
  }

  async function handleSaveEdit() {
    const e = editTarget;
    if (!e) return;
    // Student email is how the student's own login gets created on confirm —
    // required for a new_student request (a renewal's student already has
    // an account, so it's optional there). The "send updates to" address is
    // never required — it's optional at intake too, falling back to the
    // student email when left blank.
    const needsStudentEmail = e.enrollment_type === "new_student";
    const trimmedNotification = editForm.notification_email.trim();
    const trimmedStudentEmail = editForm.student_email.trim();
    if (
      !editForm.first_name.trim() ||
      (needsStudentEmail && !isValidEmail(trimmedStudentEmail)) ||
      (trimmedNotification && !isValidEmail(trimmedNotification)) ||
      (trimmedStudentEmail && !isValidEmail(trimmedStudentEmail))
    ) {
      setEditError(`First name${needsStudentEmail ? " and a valid student email" : ""} are required; any email entered must be valid.`);
      return;
    }
    const resolvedEmail = trimmedNotification || trimmedStudentEmail;
    if (!resolvedEmail) {
      setEditError("Either a student email or a \"send updates to\" email is required so the invoice can be sent.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    const { data, error } = await updateEnrollmentRequest(e.id, {
      first_name: editForm.first_name.trim(),
      last_name: editForm.last_name.trim(),
      parent_full_name: `${editForm.parent_first_name.trim()} ${editForm.parent_last_name.trim()}`.trim() || null,
      email: resolvedEmail,
      notification_email: trimmedNotification || null,
      student_email: trimmedStudentEmail || null,
      phone_number: editForm.phone_number.trim() || null,
      address: editForm.address.trim() || null,
      country: editForm.country.trim() || null,
      note: editForm.note.trim() || null,
    });
    setEditSaving(false);
    if (error || !data) { setEditError(error ?? "Failed to save changes"); return; }
    setEditTarget(null);
    // The invoice details changed, so resend it with the corrected PDF —
    // packages/proofs are untouched by this edit, so carry them over from
    // the pre-edit row instead of re-fetching. Reuses the exact same resend
    // logic already wired up above.
    await handleResend({ ...data, packages: e.packages, payment_proofs: e.payment_proofs });
    load();
  }

  async function confirmDelete() {
    const e = deleteTarget;
    if (!e) return;
    setDeleteTarget(null);
    setBusyId(e.id);
    setActionError(null);
    setActionSuccess(null);
    const { error } = await deleteEnrollmentRequest(e.id);
    setBusyId(null);
    if (error) { setActionError(error); return; }
    setActionSuccess(`Deleted the payment request for ${fullName(e)}.`);
    load();
  }

  const columns: ColumnDef<EnrollmentRequestWithDetails>[] = [
    {
      header: "Type",
      accessor: (e) => (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${e.enrollment_type === "new_student" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-purple-200 bg-purple-50 text-purple-700"}`}>
          {e.enrollment_type === "new_student" ? "New Student" : "Renewal"}
        </span>
      ),
    },
    {
      header: "Student",
      accessor: (e) => (
        <div className="min-w-0">
          <p className="font-medium text-navy-700 truncate">{fullName(e)}</p>
          <p className="text-xs text-navy-300 truncate">
            {e.student_id ?? (e.student_email || <span className="italic">No student email</span>)}
          </p>
        </div>
      ),
    },
    {
      header: "Package",
      accessor: (e) => (
        <div className="min-w-0 flex flex-col gap-0.5">
          {e.packages.map((p) => (
            <p key={p.id} className="text-xs">
              <span className="text-navy-700 font-medium">{packageLabel(p)}</span>
              <span className="text-navy-300"> · {p.hours} hrs</span>
            </p>
          ))}
        </div>
      ),
    },
    {
      header: "Proof",
      accessor: (e) => {
        if (e.payment_proofs.length === 0) return <span className="text-navy-200 text-xs">—</span>;
        if (e.payment_proofs.length === 1) {
          return (
            <button onClick={(ev) => { ev.stopPropagation(); handleViewProof(e.payment_proofs[0].storage_path); }} className="text-sky-600 hover:underline text-xs font-medium">
              📎 View
            </button>
          );
        }
        return (
          <button onClick={(ev) => { ev.stopPropagation(); setViewTarget(e); }} className="text-sky-600 hover:underline text-xs font-medium">
            📎 View ({e.payment_proofs.length})
          </button>
        );
      },
    },
    {
      header: "Status",
      accessor: (e) => (
        <div>
          <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
          {e.status === "rejected" && e.rejection_reason && <p className="text-xs text-red-500 mt-1 max-w-[180px] truncate" title={e.rejection_reason}>{e.rejection_reason}</p>}
        </div>
      ),
    },
    {
      header: "",
      className: "text-right",
      accessor: (e) => {
        const isBusy = busyId === e.id;
        const actions: RowMenuAction[] = [{ label: "View details", onClick: () => setViewTarget(e) }];
        if (e.status === "pending_payment") {
          actions.push({ label: "Edit", onClick: () => openEditDialog(e) });
          actions.push({ label: isBusy ? "Sending…" : "Resend email", onClick: () => handleResend(e) });
          actions.push({ label: "Delete", onClick: () => setDeleteTarget(e), danger: true });
        }
        if (e.status === "rejected") {
          actions.push({ label: isBusy ? "Sending…" : "Resend email", onClick: () => handleResendRejection(e) });
        }
        // Confirm/Reject are the primary, frequent action on this queue —
        // kept as visible buttons rather than tucked behind the ⋯ menu with
        // everything else.
        return (
          <div className="flex justify-end items-center gap-2">
            {e.status === "payment_submitted" && (
              <>
                <Button size="xs" variant="ghost" disabled={isBusy} onClick={(ev) => { ev.stopPropagation(); openRejectDialog(e); }}>Reject</Button>
                <Button size="xs" disabled={isBusy} onClick={(ev) => { ev.stopPropagation(); setConfirmTarget(e); }}>{isBusy ? "Working…" : "Confirm"}</Button>
              </>
            )}
            <RowMenu actions={actions} />
          </div>
        );
      },
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Enrollments"
        description="Invoice & payment-link requests for new students and renewals. Review uploaded payment screenshots here."
        action={
          <Button className="flex items-center gap-2" onClick={() => navigate("/admin/students/enroll")}>
            <IconPlus /> Add / Renew Student
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="p-4">
          <p className="text-xs text-navy-300">Awaiting payment</p>
          <p className="text-2xl font-bold text-amber-600">{loading ? "—" : counts.pending_payment ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Awaiting review</p>
          <p className="text-2xl font-bold text-sky-600">{loading ? "—" : counts.payment_submitted ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Confirmed</p>
          <p className="text-2xl font-bold text-lime-600">{loading ? "—" : counts.confirmed ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-300">Rejected</p>
          <p className="text-2xl font-bold text-red-500">{loading ? "—" : counts.rejected ?? 0}</p>
        </Card>
      </div>

      <Card className="p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextInput label="Search" placeholder="Student, email, or ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectInput
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EnrollmentStatus | "all")}
            options={[
              { value: "all", label: "All" },
              { value: "payment_submitted", label: `Awaiting Review${counts.payment_submitted ? ` (${counts.payment_submitted})` : ""}` },
              { value: "pending_payment", label: "Awaiting Payment" },
              { value: "confirmed", label: "Confirmed" },
              { value: "rejected", label: "Rejected" },
            ]}
          />
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm py-8"><Spinner /> Loading…</div>
      ) : (
        <DataTable columns={columns} rows={filtered} getRowId={(e) => e.id} onRowClick={(e) => setViewTarget(e)} emptyMessage="No enrollment requests for these filters." />
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Confirm Payment"
        description={
          confirmTarget
            ? `Confirm payment for ${fullName(confirmTarget)}? This will ${
                confirmTarget.enrollment_type === "new_student"
                  ? "create the student, add the package(s), and email login credentials"
                  : "add the hours to their package(s) and send a confirmation email"
              }.`
            : ""
        }
        confirmLabel="Confirm"
        isDangerous={false}
        onConfirm={doConfirm}
        onCancel={() => setConfirmTarget(null)}
      />

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 px-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-navy-700">Reject Payment</h2>
            <p className="mt-2 text-sm text-navy-400">
              Rejecting for <strong>{fullName(rejectTarget)}</strong> emails this note to {rejectTarget.email}, with a link to re-upload.
            </p>
            <label className="block text-xs font-medium text-navy-500 mt-4 mb-1.5">Note to include in the email</label>
            <textarea
              value={rejectNote}
              onChange={(ev) => setRejectNote(ev.target.value)}
              rows={3}
              autoFocus
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={doReject}>Reject</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Payment Request"
        description={deleteTarget ? `Permanently delete this awaiting-payment request for ${fullName(deleteTarget)}? Their payment link will stop working.` : ""}
        confirmLabel="Delete"
        isDangerous
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {viewTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 px-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setViewTarget(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-navy-700">{fullName(viewTarget)}</h2>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[viewTarget.status]}`}>
                  {STATUS_LABEL[viewTarget.status]}
                </span>
                <button
                  type="button"
                  onClick={() => setViewTarget(null)}
                  aria-label="Close"
                  className="text-navy-300 hover:text-navy-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <p className="text-xs text-navy-400 mb-1">
              {viewTarget.enrollment_type === "new_student" ? "New Student" : "Renewal"} enrollment request
            </p>

            <dl>
              <Field label="Student ID" value={viewTarget.student_id ?? <span className="text-navy-300 italic">Not created yet</span>} />
              <Field label="Student email" value={viewTarget.student_email ?? <span className="text-navy-300 italic">—</span>} />
              <Field label="Send updates to" value={viewTarget.email} />
              <Field label="Curriculum" value={viewTarget.curriculum ?? <span className="text-navy-300 italic">—</span>} />
              <Field label="Parent/Guardian name" value={viewTarget.parent_full_name ?? <span className="text-navy-300 italic">—</span>} />
              <Field label="Parent/Guardian phone" value={viewTarget.phone_number ?? <span className="text-navy-300 italic">—</span>} />
              <Field label="Address" value={viewTarget.address ?? <span className="text-navy-300 italic">—</span>} />
              <Field label="Country" value={viewTarget.country ?? <span className="text-navy-300 italic">—</span>} />
              {viewTarget.report_card_url && (
                <Field label="Report card" value={<span className="text-navy-300 italic">Uploaded</span>} />
              )}
              <Field
                label={viewTarget.packages.length > 1 ? `Packages (${viewTarget.packages.length})` : "Package"}
                value={
                  <div className="flex flex-col gap-1.5">
                    {viewTarget.packages.map((p, i) => (
                      <div key={p.id} className="flex justify-between gap-3">
                        <span>{viewTarget.packages.length > 1 ? `${i + 1}. ` : ""}{packageLabel(p)} — {p.package_size_label}</span>
                        <span className="text-navy-400 shrink-0">{p.hours} hrs</span>
                      </div>
                    ))}
                  </div>
                }
              />
              <Field label="Performance Coach" value={coordinatorNameFor(viewTarget)} />
              {viewTarget.note && <Field label="Note" value={viewTarget.note} />}
              <Field label="Requested" value={new Date(viewTarget.created_at).toLocaleString()} />
              {viewTarget.status === "confirmed" && viewTarget.confirmed_at && (
                <Field label="Confirmed" value={new Date(viewTarget.confirmed_at).toLocaleString()} />
              )}
              {viewTarget.status === "rejected" && viewTarget.rejection_reason && (
                <Field label="Rejection reason" value={viewTarget.rejection_reason} />
              )}
              {viewTarget.payment_proofs.length > 0 && (
                <Field
                  label={viewTarget.payment_proofs.length > 1 ? `Payment proofs (${viewTarget.payment_proofs.length})` : "Payment proof"}
                  value={
                    <div className="flex flex-col gap-1">
                      {viewTarget.payment_proofs.map((proof, i) => (
                        <button key={proof.id} onClick={() => handleViewProof(proof.storage_path)} className="text-sky-600 hover:underline text-sm font-medium text-left">
                          📎 View screenshot{viewTarget.payment_proofs.length > 1 ? ` ${i + 1}` : ""}
                        </button>
                      ))}
                    </div>
                  }
                />
              )}
            </dl>

            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setViewTarget(null)}>Close</Button>
              {viewTarget.status === "pending_payment" && (
                <Button size="sm" onClick={() => { const e = viewTarget; setViewTarget(null); openEditDialog(e); }}>Edit</Button>
              )}
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 px-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-navy-700">Edit Payment Request</h2>
            <p className="mt-1 text-sm text-navy-400">
              Fixes details on this still-unpaid request for <strong>{fullName(editTarget)}</strong>. Saving resends the invoice email with the corrected details.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <TextInput label="First name" value={editForm.first_name} onChange={(ev) => setEditForm((f) => ({ ...f, first_name: ev.target.value }))} required />
              <TextInput label="Last name (optional)" value={editForm.last_name} onChange={(ev) => setEditForm((f) => ({ ...f, last_name: ev.target.value }))} />
              <TextInput label="Parent/Guardian first name (optional)" value={editForm.parent_first_name} onChange={(ev) => setEditForm((f) => ({ ...f, parent_first_name: ev.target.value }))} />
              <TextInput label="Parent/Guardian last name (optional)" value={editForm.parent_last_name} onChange={(ev) => setEditForm((f) => ({ ...f, parent_last_name: ev.target.value }))} />
              <div>
                <TextInput
                  label="Student email"
                  type="email"
                  value={editForm.student_email}
                  onChange={(ev) => setEditForm((f) => ({ ...f, student_email: ev.target.value }))}
                  required={editTarget.enrollment_type === "new_student"}
                />
                {editForm.student_email.trim().length > 0 && !isValidEmail(editForm.student_email) && <p className="text-xs text-red-500 mt-1">Enter a valid email address.</p>}
              </div>
              <div>
                <TextInput label="Send updates to (optional)" type="email" value={editForm.notification_email} onChange={(ev) => setEditForm((f) => ({ ...f, notification_email: ev.target.value }))} />
                {editForm.notification_email.trim().length > 0 && !isValidEmail(editForm.notification_email) && <p className="text-xs text-red-500 mt-1">Enter a valid email address.</p>}
                <p className="text-xs text-navy-400 mt-1">Falls back to the student email if left blank.</p>
              </div>
              <TextInput label="Country" value={editForm.country} onChange={(ev) => setEditForm((f) => ({ ...f, country: ev.target.value }))} />
              <TextInput label="Phone" value={editForm.phone_number} onChange={(ev) => setEditForm((f) => ({ ...f, phone_number: ev.target.value }))} />
              <TextInput label="Address" value={editForm.address} onChange={(ev) => setEditForm((f) => ({ ...f, address: ev.target.value }))} />
            </div>
            <div className="mt-3">
              <TextInput label="Note" value={editForm.note} onChange={(ev) => setEditForm((f) => ({ ...f, note: ev.target.value }))} />
            </div>
            {editTarget.enrollment_type === "new_student" && (
              <p className="mt-2 text-xs text-navy-400">Student email is required — it's how the student's own login gets created once payment is confirmed.</p>
            )}
            <p className="mt-2 text-xs text-navy-400">Packages, course type, and Performance Coach can't be changed here — delete and re-create the request instead.</p>
            {editError && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{editError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={editSaving}>{editSaving ? "Saving…" : "Save & Resend"}</Button>
            </div>
          </div>
        </div>
      )}

      {actionSuccess && <Toast message={actionSuccess} variant="success" onDismiss={() => setActionSuccess(null)} />}
      {actionError && <Toast message={actionError} variant="error" onDismiss={() => setActionError(null)} />}
    </AdminLayout>
  );
}

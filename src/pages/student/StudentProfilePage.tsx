import { useEffect, useState, type ReactNode } from "react";
import { StudentScreen } from "./StudentScreen";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";
import { useMyStudent } from "../../hooks/useMyStudent";
import { supabase } from "../../lib/supabaseClient";
import {
  StudentInfoFields,
  StudentInfoReadOnly,
  SectionLabel,
  studentInfoValueFromStudent,
  studentInfoValueToFields,
  missingStudentInfoFields,
  type StudentInfoValue,
} from "../../components/portal/StudentInfoFields";
import { studentNeedsProfileCompletion } from "../../utils/profileCompletion";
import type { Student } from "../../types/database";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-navy-400 w-32 shrink-0">{label}</dt>
      <dd className="text-navy-700 font-medium break-all">{value ?? <span className="text-navy-300 italic">—</span>}</dd>
    </div>
  );
}

// Everything about the student's own info in one card, grouped into the
// same sections as the mandatory first-login form (StudentCompleteProfileGate.tsx)
// so the two never look inconsistent. ID/name/email/username are set at
// account creation, and email/username/password are only ever changeable
// once, as part of that first-login form, never from here. Everything else
// (phone/school/curriculum/address/parent info) stays a one-time editable
// form here until complete, then locks read-only — only admin can change it
// afterward, from the student detail page. The "send updates to" email and
// the report card are the two exceptions that stay editable at any time.
function StudentInfoCard({ student }: { student: Student }) {
  const { profile } = useAuth();
  const { updateMyProfile } = useMyStudent();
  const [value, setValue] = useState<StudentInfoValue>(() => studentInfoValueFromStudent(student));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notificationEmail, setNotificationEmail] = useState(student.notification_email ?? "");
  const [savingNotify, setSavingNotify] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

  const [reportCardFile, setReportCardFile] = useState<File | null>(null);
  const [savingReportCard, setSavingReportCard] = useState(false);
  const [reportCardMsg, setReportCardMsg] = useState<string | null>(null);
  // Signed URL for the currently-on-file report card, if any — refetched
  // whenever the underlying path changes (i.e. after a fresh upload).
  const [reportCardUrl, setReportCardUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!student.report_card_url) {
        if (!cancelled) setReportCardUrl(null);
        return;
      }
      const { data } = await supabase.storage.from("report-cards").createSignedUrl(student.report_card_url, 3600);
      if (!cancelled) setReportCardUrl(data?.signedUrl ?? null);
    }
    load();
    return () => { cancelled = true; };
  }, [student.report_card_url]);

  async function handleSave() {
    const missing = missingStudentInfoFields(value);
    if (missing.length > 0) { setError(`Please fill in: ${missing.join(", ")}.`); return; }
    setSaving(true);
    setError(null);
    const { error } = await updateMyProfile(studentInfoValueToFields(value));
    setSaving(false);
    if (error) setError(error);
  }

  async function handleSaveNotify() {
    if (!notificationEmail.trim()) { setNotifyMsg("Required — enter an email."); return; }
    setSavingNotify(true);
    setNotifyMsg(null);
    const { error } = await updateMyProfile({ notification_email: notificationEmail.trim() });
    setSavingNotify(false);
    setNotifyMsg(error ? error : "Saved.");
  }

  async function handleUploadReportCard() {
    if (!reportCardFile) return;
    setSavingReportCard(true);
    setReportCardMsg(null);
    const ext = reportCardFile.name.includes(".") ? reportCardFile.name.split(".").pop() : "";
    const path = `${student.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    const { error: uploadError } = await supabase.storage.from("report-cards").upload(path, reportCardFile, { upsert: false });
    if (uploadError) { setSavingReportCard(false); setReportCardMsg(uploadError.message); return; }
    const { error } = await updateMyProfile({ report_card_url: path });
    setSavingReportCard(false);
    setReportCardMsg(error ? error : "Uploaded.");
    if (!error) setReportCardFile(null);
  }

  const complete = !studentNeedsProfileCompletion(student);

  return (
    <Card className="p-8">
      <p className="text-lg font-semibold text-navy-700">Your Information</p>
      <p className="text-sm text-navy-400 mb-6">Account, contact, school, and guardian details.</p>

      <div className="flex flex-col gap-4">
        <div>
          <SectionLabel>Account</SectionLabel>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Student ID" value={student.id} />
            <InfoRow label="Username" value={profile?.username} />
            <InfoRow label="First name" value={student.first_name} />
            <InfoRow label="Last name" value={student.last_name} />
            <InfoRow label="Email (login)" value={student.email ?? profile?.email} />
          </dl>
        </div>

        <div className="border-t border-navy-50 pt-4">
          <SectionLabel>Send updates to</SectionLabel>
          <div className="flex gap-2">
            <input
              type="email"
              value={notificationEmail}
              onChange={(e) => { setNotificationEmail(e.target.value); setNotifyMsg(null); }}
              placeholder="you@example.com"
              className="flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <Button onClick={handleSaveNotify} disabled={savingNotify}>{savingNotify ? "Saving…" : "Save"}</Button>
          </div>
          {notifyMsg && <p className={`text-xs mt-1 ${notifyMsg === "Saved." ? "text-green-600" : "text-red-600"}`}>{notifyMsg}</p>}
        </div>

        <div className="border-t border-navy-50 pt-4">
          {complete ? (
            <StudentInfoReadOnly student={student} />
          ) : (
            <>
              <StudentInfoFields value={value} onChange={setValue} required />
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-3">{error}</p>}
              <Button onClick={handleSave} disabled={saving} className="mt-4">
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>

        <div className="border-t border-navy-50 pt-4">
          <SectionLabel>Report card</SectionLabel>
          <p className="text-sm mb-2">
            {reportCardUrl ? (
              <>
                <span className="text-green-600 font-medium">✓ On file</span>
                {" — "}
                <a href={reportCardUrl} target="_blank" rel="noreferrer" className="text-sky-500 hover:text-sky-700 underline">View</a>
              </>
            ) : (
              <span className="text-navy-400">No report card uploaded yet.</span>
            )}
          </p>
          <div className="flex gap-2 items-center">
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => { setReportCardFile(e.target.files?.[0] ?? null); setReportCardMsg(null); }}
              className="flex-1 text-sm text-navy-500 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
            />
            <Button onClick={handleUploadReportCard} disabled={!reportCardFile || savingReportCard}>
              {savingReportCard ? "Uploading…" : reportCardUrl ? "Replace" : "Upload"}
            </Button>
          </div>
          {reportCardMsg && <p className={`text-xs mt-1 ${reportCardMsg === "Uploaded." ? "text-green-600" : "text-red-600"}`}>{reportCardMsg}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function StudentProfilePage() {
  return (
    <StudentScreen
      title="Profile"
      description="Your account details and contact info."
      render={(student) => (
        <div className="max-w-3xl flex flex-col gap-5">
          <StudentInfoCard student={student} />
          <p className="text-xs text-navy-400">
            Name, email, username, and password can only be changed at your first login — contact your Performance Coach if something needs correcting.
          </p>
        </div>
      )}
    />
  );
}

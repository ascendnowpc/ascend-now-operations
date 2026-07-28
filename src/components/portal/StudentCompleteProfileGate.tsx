import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/Input";
import {
  StudentInfoFields,
  studentInfoValueFromStudent,
  studentInfoValueToFields,
  missingStudentInfoFields,
  type StudentInfoValue,
} from "./StudentInfoFields";
import type { Student } from "../../types/database";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string) {
  return EMAIL_RE.test(v.trim());
}

// Full-screen, mandatory — shown by StudentLayout instead of the normal
// dashboard whenever the logged-in student's own required fields (phone,
// graduation year, birthday, school, curriculum, address/country, the
// guardian's name/phone, and the "send emails to" address) are still
// missing. None of these are required at admin add time (the admin may not
// know them), so this is the one point they're actually enforced. The
// report-card upload is the one genuinely optional field here.
//
// This is also the ONLY place a student can ever set their own name, email,
// username, or password — the name fields are optional here (last name isn't
// required at admin enrollment either), and none of these are editable again
// afterward (not even from the ongoing Profile tab), since this gate never
// shows again once the required fields above are on file.
export function StudentCompleteProfileGate({
  student,
  updateMyProfile,
}: {
  student: Student;
  updateMyProfile: (fields: Partial<ReturnType<typeof studentInfoValueToFields> & { email: string; first_name: string; last_name: string; notification_email: string | null; report_card_url: string | null }>) => Promise<{ error: string | null }>;
}) {
  const { profile, signOut, updateUsername, updateEmail, updatePassword } = useAuth();
  const [value, setValue] = useState<StudentInfoValue>(() => studentInfoValueFromStudent(student));
  const [firstName, setFirstName] = useState(student.first_name);
  const [lastName, setLastName] = useState(student.last_name);
  const [email, setEmail] = useState(student.email ?? profile?.email ?? "");
  // The address they want our emails (invoices/updates) sent to — required,
  // may match or differ from their login email. "Same as student email"
  // fills it in from the (possibly just-edited) email above; unticking lets
  // them type a different one.
  const [notificationEmail, setNotificationEmail] = useState(student.notification_email ?? student.email ?? "");
  const [sameAsStudentEmail, setSameAsStudentEmail] = useState(
    !!student.notification_email && student.notification_email === student.email
  );
  // Optional — the only field on this whole gate that isn't required.
  const [reportCardFile, setReportCardFile] = useState<File | null>(null);
  const [username, setUsername] = useState(profile?.username ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const missing = missingStudentInfoFields(value);
    if (missing.length > 0) { setError(`Please fill in: ${missing.join(", ")}.`); return; }
    if (!firstName.trim()) { setError("First name is required."); return; }
    const effectiveNotificationEmail = sameAsStudentEmail ? email.trim() : notificationEmail.trim();
    if (!effectiveNotificationEmail) { setError("Please provide an email to send updates to (or tick \"Same as student email\")."); return; }
    if (!isValidEmail(effectiveNotificationEmail)) { setError("Enter a valid email to send updates to."); return; }
    if (newPassword && newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPassword && newPassword !== confirmPassword) { setError("Passwords do not match."); return; }

    setSaving(true);
    setError(null);

    // Uploaded under the student's own id so the storage policy (INSERT
    // scoped to a path prefixed with students.id) allows it.
    let reportCardPath: string | null = null;
    if (reportCardFile) {
      const ext = reportCardFile.name.includes(".") ? reportCardFile.name.split(".").pop() : "";
      const path = `${student.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
      const { error: uploadError } = await supabase.storage.from("report-cards").upload(path, reportCardFile, { upsert: false });
      if (uploadError) { setSaving(false); setError(`Failed to upload report card: ${uploadError.message}`); return; }
      reportCardPath = path;
    }

    const { error: profileError } = await updateMyProfile({
      ...studentInfoValueToFields(value),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      notification_email: effectiveNotificationEmail,
      ...(reportCardPath ? { report_card_url: reportCardPath } : {}),
    });
    if (profileError) { setSaving(false); setError(profileError); return; }

    const trimmedUsername = username.trim();
    if (trimmedUsername && trimmedUsername !== profile?.username) {
      const { error: usernameError } = await updateUsername(trimmedUsername);
      if (usernameError) { setSaving(false); setError(usernameError); return; }
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail && trimmedEmail !== (student.email ?? profile?.email)) {
      const { error: emailError } = await updateEmail(trimmedEmail);
      if (emailError) { setSaving(false); setError(emailError); return; }
      await updateMyProfile({ email: trimmedEmail });
    }

    if (newPassword) {
      const { error: passwordError } = await updatePassword(newPassword);
      if (passwordError) { setSaving(false); setError(passwordError); return; }
    }

    setSaving(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-25 px-4 py-10">
      <div className="bg-white rounded-2xl shadow-lg border border-navy-100 p-8 max-w-md w-full flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-semibold text-navy-700">Complete your profile</h2>
          <p className="text-sm text-navy-400">A few details before you continue.</p>
        </div>

        <StudentInfoFields value={value} onChange={setValue} required />

        <div className="border-t border-navy-50 pt-4">
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">Documents</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1">
                Send emails to<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="email"
                value={sameAsStudentEmail ? email : notificationEmail}
                disabled={sameAsStudentEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:bg-navy-25 disabled:text-navy-400"
              />
              <label className="mt-1.5 flex items-center gap-2 text-xs text-navy-500">
                <input
                  type="checkbox"
                  checked={sameAsStudentEmail}
                  onChange={(e) => setSameAsStudentEmail(e.target.checked)}
                />
                Same as student email
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1">Report card</label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setReportCardFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-navy-500 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
              />
              <p className="text-xs text-navy-300 mt-1">Optional.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-navy-50 pt-4">
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Account settings</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextInput label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="off" />
            <TextInput label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Optional" autoComplete="off" />
          </div>
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="off" />
          <TextInput label="Username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="off" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextInput label="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Leave blank to keep current" autoComplete="new-password" />
            <TextInput label="Confirm new password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
          </div>
          <p className="text-xs text-navy-300">This is your only chance to change these.</p>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? "Saving…" : "Save & Continue"}
          </Button>
          <Button type="button" variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

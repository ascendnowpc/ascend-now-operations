import { useState, type ReactNode } from "react";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { AccountSecurityCards } from "../../components/account/AccountSecurityCards";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { COUNTRY_OPTIONS } from "../../data/countries";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 border-b border-navy-50 last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-navy-300">{label}</span>
      <span className="text-sm text-navy-700">{value ?? <span className="text-navy-300">—</span>}</span>
    </div>
  );
}

// Merged "My Profile" + "Settings" — a teacher/coach previously had to visit
// two separate pages for what is really one account: personal/contact info,
// login username, and password. Now all three live in one place. The old
// "profile photo" upload feature has been removed entirely, app-wide. As of
// 2026-07-07, StudentProfilePage.tsx/ParentProfilePage.tsx got the identical
// merge (their old separate Settings pages, and the SettingsContent
// component they shared, are gone too).
export default function TeacherProfilePage() {
  const { profile, updateUsername, updateEmail, updatePassword } = useAuth();
  const { teacher, loading, error, updateMyProfile } = useMyTeacherProfile();

  // ── Personal information ──
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("+1");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function startEdit() {
    if (!teacher) return;
    setFirstName(teacher.first_name);
    setLastName(teacher.last_name ?? "");
    setEmail(teacher.email ?? profile?.email ?? "");
    // Parse stored phone back into dial code + local number.
    const stored = teacher.phone_number ?? "";
    const match = stored.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match) { setDialCode(match[1]); setPhone(match[2]); }
    else { setDialCode("+1"); setPhone(stored); }
    setCountry(teacher.country ?? "");
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!firstName.trim()) { setSaveError("First name is required."); return; }
    setSaving(true);
    setSaveError(null);
    const fullPhone = phone.trim() ? `${dialCode} ${phone.trim()}` : null;
    const trimmedEmail = email.trim() || null;

    // Email change goes through updateEmail (the update-user-email edge
    // function), which syncs the Auth login credential, public.users.email,
    // and teachers.email together. Do it FIRST so a failure (e.g. the address
    // is already taken) aborts the whole save before any other field is
    // touched — and so this stays the single owner of email writes (the
    // updateMyProfile call below deliberately no longer sends email).
    if (trimmedEmail && trimmedEmail !== (teacher?.email ?? profile?.email ?? null)) {
      const { error: emailError } = await updateEmail(trimmedEmail);
      if (emailError) { setSaving(false); setSaveError(emailError); return; }
    }

    const { error } = await updateMyProfile({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone_number: fullPhone,
      country: country.trim() || null,
    });
    if (error) { setSaving(false); setSaveError(error); return; }
    setSaving(false);
    setEditing(false);
  }

  const fullName = teacher ? `${teacher.first_name} ${teacher.last_name ?? ""}`.trim() : "";
  const initials = teacher ? `${teacher.first_name[0] ?? ""}${teacher.last_name?.[0] ?? ""}` : "";

  return (
    <TeacherLayout>
      <PageHeader title="My Profile" description="Your account details and login settings." />

      {loading && <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 max-w-xl">{error}</p>
      )}

      {!loading && teacher && (
        <div className="max-w-xl flex flex-col gap-5">
          {/* Identity header */}
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                <span className="text-2xl font-bold text-sky-500">{initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-navy-800 truncate">{fullName}</p>
                <p className="text-sm text-navy-400">
                  {teacher.is_performance_coach ? "Teacher & Performance Coach" : "Teacher"}
                </p>
              </div>
            </div>
          </Card>

          {/* Personal information */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold text-navy-700">Personal information</p>
              {!editing && (
                <button onClick={startEdit} className="text-sm text-sky-500 hover:text-sky-700 font-medium">
                  Edit
                </button>
              )}
            </div>

            {!editing ? (
              <dl className="grid grid-cols-2 gap-x-6">
                {/* Their staff id, same as a coach sees on /teacher/pc-profile
                    and a student on their own profile page. */}
                <InfoRow label="ID" value={<span className="font-mono">{teacher.id}</span>} />
                <InfoRow label="First name" value={teacher.first_name} />
                <InfoRow label="Last name" value={teacher.last_name} />
                <InfoRow label="Email" value={teacher.email ?? profile?.email} />
                <InfoRow label="Phone" value={teacher.phone_number} />
                <InfoRow label="Country" value={teacher.country} />
              </dl>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <TextInput label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                  <TextInput label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
                <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <PhoneInput
                  label="Phone number"
                  dialCode={dialCode}
                  onDialCodeChange={setDialCode}
                  phoneNumber={phone}
                  onPhoneNumberChange={setPhone}
                />
                {/* Country and dial code are independent fields — picking a
                    country here never touches the dial code (unlike a
                    first-time enrollment form, this is always editing an
                    existing, already-set phone number). */}
                <SelectInput
                  label="Country"
                  placeholder="Select a country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  options={COUNTRY_OPTIONS}
                />

                {saveError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</p>
                )}

                <div className="flex gap-3 pt-1">
                  <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>

          <AccountSecurityCards username={profile?.username} updateUsername={updateUsername} updatePassword={updatePassword} />
        </div>
      )}
    </TeacherLayout>
  );
}

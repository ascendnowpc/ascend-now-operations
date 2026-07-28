import { useState } from "react";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { AccountSecurityCards } from "../../components/account/AccountSecurityCards";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { usePcProfile } from "../../hooks/usePcProfile";
import { PcProfileCard, PcEducationSidebar, InfoRow, initialsOf } from "../../components/pc/PcProfileCard";
import { COUNTRY_OPTIONS } from "../../data/countries";
import type { Teacher } from "../../types/database";

// The coach's own name/email/phone/country, editable, shown in the same
// header spot the read-only public contact info used to sit — the admin-set
// profile photo (the one students see) stays as-is, only the personal
// fields underneath it become editable. Mirrors the edit-toggle pattern
// TeacherProfilePage used for the same fields.
function PersonalInfoHeader({
  teacher,
  photoUrl,
  department,
  authEmail,
  updateMyProfile,
  updateEmail,
}: {
  teacher: Teacher;
  photoUrl: string | null;
  department: string | null;
  authEmail: string | undefined;
  updateMyProfile: (
    fields: Partial<Pick<Teacher, "first_name" | "last_name" | "email" | "phone_number" | "country">>
  ) => Promise<{ error: string | null }>;
  updateEmail: (email: string) => Promise<{ error: string | null }>;
}) {
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
    setFirstName(teacher.first_name);
    setLastName(teacher.last_name ?? "");
    setEmail(teacher.email ?? authEmail ?? "");
    const stored = teacher.phone_number ?? "";
    const match = stored.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match) { setDialCode(match[1]); setPhone(match[2]); }
    else { setDialCode("+1"); setPhone(stored); }
    setCountry(teacher.country ?? "");
    setSaveError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!firstName.trim()) { setSaveError("First name is required."); return; }
    setSaving(true);
    setSaveError(null);
    const fullPhone = phone.trim() ? `${dialCode} ${phone.trim()}` : null;
    const trimmedEmail = email.trim() || null;

    // Email change goes through updateEmail first (see TeacherProfilePage),
    // so a failure aborts before any other field is touched.
    if (trimmedEmail && trimmedEmail !== (teacher.email ?? authEmail ?? null)) {
      const { error: emailError } = await updateEmail(trimmedEmail);
      if (emailError) { setSaving(false); setSaveError(emailError); return; }
    }

    const { error } = await updateMyProfile({
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      phone_number: fullPhone,
      country: country.trim() || null,
    });
    if (error) { setSaving(false); setSaveError(error); return; }
    setSaving(false);
    setEditing(false);
  }

  const name = `${teacher.first_name} ${teacher.last_name ?? ""}`.trim();

  return (
    <div className="flex items-start gap-4 sm:gap-5">
      <div className="shrink-0">
        {photoUrl ? (
          <img src={photoUrl} alt={name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover ring-4 ring-sky-50" />
        ) : (
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-sky-50 ring-4 ring-sky-50 flex items-center justify-center">
            <span className="text-2xl font-bold text-sky-500">{initialsOf(name)}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {department && (
          <span className="inline-block bg-sky-100 text-navy-700 text-[10px] font-semibold px-2 py-0.5 rounded mb-1.5">
            {department}
          </span>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl sm:text-2xl font-extrabold text-navy-800 truncate">{name}</h2>
          {!editing && (
            <button type="button" onClick={startEdit} className="text-xs font-semibold text-sky-500 hover:text-sky-600 shrink-0">
              Edit
            </button>
          )}
        </div>

        {!editing ? (
          <div className="mt-3 flex flex-col gap-1">
            {(teacher.email ?? authEmail) && <InfoRow label="Email" value={teacher.email ?? authEmail} />}
            {teacher.phone_number && <InfoRow label="Phone" value={teacher.phone_number} />}
            {teacher.country && <InfoRow label="Country" value={teacher.country} />}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3 max-w-md">
            <div className="grid grid-cols-2 gap-3">
              <TextInput label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              <TextInput label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <PhoneInput
              label="Phone number"
              dialCode={dialCode}
              onDialCodeChange={setDialCode}
              phoneNumber={phone}
              onPhoneNumberChange={setPhone}
            />
            <SelectInput
              label="Country"
              placeholder="Select a country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              options={COUNTRY_OPTIONS}
            />
            {saveError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// A performance coach's merged account + public profile page — combines
// what used to be two separate tabs ("My Profile" and "Coach Profile").
// Personal info (name/email/phone/country) is editable here, in the same
// spot the read-only public contact info used to sit; the rest of the card
// (about, achievements, the Performance Coach timeline) stays admin-
// maintained and read-only, exactly what assigned students see. Education
// renders as its usual side column, with the account's Username/Password
// change cards below it — always available even before an admin has set up
// the coach's public profile.
export default function PcProfilePage() {
  const { profile: authProfile, updateEmail, updatePassword, updateUsername } = useAuth();
  const { teacher, loading: teacherLoading, updateMyProfile } = useMyTeacherProfile();
  const { profile, loading: profileLoading } = usePcProfile(teacher?.id);

  const coachName = teacher ? `${teacher.first_name} ${teacher.last_name ?? ""}`.trim() : "";
  const loading = teacherLoading || profileLoading;
  const hasProfile = !!profile && profile.is_published;

  return (
    <TeacherLayout>
      <PageHeader title="My Profile" description="Your account, login settings, and the profile your assigned students see." />

      {loading && (
        <div className="flex items-center gap-2 text-navy-300 text-sm">
          <Spinner /> Loading…
        </div>
      )}

      {!loading && teacher && (
        <div className="flex flex-col lg:flex-row gap-6 lg:justify-center lg:items-start">
          <div className="max-w-3xl w-full mx-auto lg:mx-0 lg:flex-1 lg:min-w-0 flex flex-col gap-5">
            <PersonalInfoHeader
              teacher={teacher}
              photoUrl={profile?.photo_url ?? null}
              department={profile?.department ?? null}
              authEmail={authProfile?.email}
              updateMyProfile={updateMyProfile}
              updateEmail={updateEmail}
            />

            {hasProfile ? (
              <PcProfileCard profile={profile!} coachName={coachName} header={null} />
            ) : (
              <Card className="p-8 text-center">
                <p className="text-navy-700 font-semibold text-lg">No public profile yet</p>
                <p className="text-sm text-navy-400 mt-1">
                  Your public profile — the one your assigned students see — is set up by an admin.
                </p>
              </Card>
            )}
          </div>

          <div className="w-full lg:w-72 lg:shrink-0 flex flex-col gap-4">
            {hasProfile && <PcEducationSidebar education={profile!.education} />}
            <AccountSecurityCards username={authProfile?.username} updateUsername={updateUsername} updatePassword={updatePassword} />
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}

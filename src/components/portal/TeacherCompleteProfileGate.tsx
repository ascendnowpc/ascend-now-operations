import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../ui/Input";
import { COUNTRY_OPTIONS } from "../../data/countries";
import { TeacherSubjectEditor } from "../subjects/TeacherSubjectEditor";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllSubjectCategories } from "../../hooks/useSubjectCategories";
import { useAllCurriculumGroups } from "../../hooks/useCurriculumGroups";
import type { Teacher } from "../../types/database";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string) {
  return EMAIL_RE.test(v.trim());
}

// Full-screen, mandatory — shown by TeacherLayout instead of the normal
// dashboard whenever the logged-in teacher's own required fields (last
// name, email, phone, country) are still missing. None of these are
// required at admin add time (only first name is), so this is the one point
// they're actually enforced — mirrors StudentCompleteProfileGate.tsx.
//
// Unlike the student gate, name/email/username/password stay editable
// afterward too, from the ongoing "My Profile" page (TeacherProfilePage.tsx)
// — this gate is just where a teacher fills them in for the first time.
export function TeacherCompleteProfileGate({
  teacher,
  updateMyProfile,
}: {
  teacher: Teacher;
  updateMyProfile: (
    fields: Partial<Pick<Teacher, "first_name" | "last_name" | "email" | "phone_number" | "country">>
  ) => Promise<{ error: string | null }>;
}) {
  const { profile, signOut, updateUsername, updateEmail, updatePassword } = useAuth();
  const { subjects: allSubjectsAll, createSubject } = useAllSubjects();
  const { curricula } = useCurricula();
  const { categories } = useAllSubjectCategories();
  const { groups: allGroups } = useAllCurriculumGroups();
  const academicCategories = categories.filter((c) => c.type === "academic" && c.is_active);
  const [firstName, setFirstName] = useState(teacher.first_name);
  const [lastName, setLastName] = useState(teacher.last_name ?? "");
  const [email, setEmail] = useState(teacher.email ?? profile?.email ?? "");
  const storedPhone = teacher.phone_number ?? "";
  const phoneMatch = storedPhone.match(/^(\+\d{1,4})\s*(.*)$/);
  const [dialCode, setDialCode] = useState(phoneMatch ? phoneMatch[1] : "+1");
  const [phone, setPhone] = useState(phoneMatch ? phoneMatch[2] : storedPhone);
  const [country, setCountry] = useState(teacher.country ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!firstName.trim()) { setError("First name is required."); return; }
    if (!lastName.trim()) { setError("Last name is required."); return; }
    if (!country.trim()) { setError("Country is required."); return; }
    if (!phone.trim()) { setError("Phone number is required."); return; }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError("Email is required."); return; }
    if (!isValidEmail(trimmedEmail)) { setError("Enter a valid email address."); return; }
    if (newPassword && newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPassword && newPassword !== confirmPassword) { setError("Passwords do not match."); return; }

    setSaving(true);
    setError(null);

    // Email changes go through updateEmail (the update-user-email edge
    // function) FIRST so it syncs the Auth login credential, public.users.email,
    // and teachers.email together — a failure (e.g. address already taken)
    // then aborts before any other field is touched. The email is also sent
    // via updateMyProfile below regardless, so it lands on teachers.email
    // even if it already matched the account's login email but had never
    // been written to this row.
    const currentEmail = teacher.email ?? profile?.email ?? "";
    if (trimmedEmail !== currentEmail) {
      const { error: emailError } = await updateEmail(trimmedEmail);
      if (emailError) { setSaving(false); setError(emailError); return; }
    }

    const { error: profileError } = await updateMyProfile({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone_number: `${dialCode} ${phone.trim()}`,
      country,
      email: trimmedEmail,
    });
    if (profileError) { setSaving(false); setError(profileError); return; }

    const trimmedUsername = username.trim();
    if (trimmedUsername && trimmedUsername !== profile?.username) {
      const { error: usernameError } = await updateUsername(trimmedUsername);
      if (usernameError) { setSaving(false); setError(usernameError); return; }
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

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextInput label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="off" />
            <TextInput label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="off" />
          </div>
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="off" />
          <PhoneInput
            label="Phone number"
            dialCode={dialCode}
            onDialCodeChange={setDialCode}
            phoneNumber={phone}
            onPhoneNumberChange={setPhone}
            required
          />
          <SelectInput
            label="Country"
            placeholder="Select a country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            options={COUNTRY_OPTIONS}
            required
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-navy-50 pt-4">
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Account settings</p>
          <TextInput label="Username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="off" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextInput label="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Leave blank to keep current" autoComplete="new-password" />
            <TextInput label="Confirm new password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-navy-50 pt-4">
          <div>
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Your subjects (optional)</p>
            <p className="text-xs text-navy-300 mt-0.5">Add the subjects you teach now, or anytime later from My Subjects.</p>
          </div>
          <TeacherSubjectEditor
            variant="teacher"
            teacherId={teacher.id}
            allSubjects={allSubjectsAll}
            curricula={curricula}
            allGroups={allGroups}
            academicCategories={academicCategories}
            createSubject={createSubject}
          />
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

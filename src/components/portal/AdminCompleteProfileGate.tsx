import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../ui/Input";
import { COUNTRY_OPTIONS, COUNTRY_DIAL_CODES } from "../../data/countries";
import { splitPhoneNumber, joinPhoneNumber } from "../../utils/phoneNumber";
import type { Admin } from "../../types/database";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string) {
  return EMAIL_RE.test(v.trim());
}

// Full-screen, mandatory — shown by AdminLayout instead of the dashboard
// whenever the logged-in admin's own phone number or country is still
// missing. Neither is captured when another admin creates the account, so
// this is the one point they're actually enforced. Mirrors
// TeacherCompleteProfileGate.tsx / StudentCompleteProfileGate.tsx, and, like
// those, everything here stays editable afterwards from My Profile.
export function AdminCompleteProfileGate({
  admin,
  updateMyProfile,
}: {
  admin: Admin;
  updateMyProfile: (
    fields: Partial<Pick<Admin, "phone_number" | "country">>
  ) => Promise<{ error: string | null }>;
}) {
  const { profile, signOut, updateFullName, updateUsername, updateEmail, updatePassword } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const storedPhone = splitPhoneNumber(admin.phone_number);
  const [dialCode, setDialCode] = useState(storedPhone.dialCode);
  const [phone, setPhone] = useState(storedPhone.number);
  const [country, setCountry] = useState(admin.country ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!fullName.trim()) { setError("Full name is required."); return; }
    if (!country.trim()) { setError("Country is required."); return; }
    if (!phone.trim()) { setError("Phone number is required."); return; }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError("Email is required."); return; }
    if (!isValidEmail(trimmedEmail)) { setError("Enter a valid email address."); return; }
    if (newPassword && newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPassword && newPassword !== confirmPassword) { setError("Passwords do not match."); return; }

    setSaving(true);
    setError(null);

    // Email goes through updateEmail (the update-user-email edge function)
    // FIRST so the Auth login credential and public.users.email stay in sync
    // and a failure — e.g. address already taken — aborts before anything
    // else is written. Same ordering as the teacher gate.
    if (trimmedEmail.toLowerCase() !== (profile?.email ?? "").toLowerCase()) {
      const { error: emailError } = await updateEmail(trimmedEmail);
      if (emailError) { setSaving(false); setError(emailError); return; }
    }

    if (fullName.trim() !== (profile?.full_name ?? "")) {
      const { error: nameError } = await updateFullName(fullName.trim());
      if (nameError) { setSaving(false); setError(nameError); return; }
    }

    const { error: profileError } = await updateMyProfile({
      phone_number: joinPhoneNumber(dialCode, phone),
      country,
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
          <TextInput label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="off" />
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="off" />
          <SelectInput
            label="Country"
            placeholder="Select a country"
            value={country}
            onChange={(e) => {
              const next = e.target.value;
              setCountry(next);
              const dial = COUNTRY_DIAL_CODES[next];
              if (dial) setDialCode(dial);
            }}
            options={COUNTRY_OPTIONS}
            required
          />
          <PhoneInput
            label="Phone number"
            dialCode={dialCode}
            onDialCodeChange={setDialCode}
            phoneNumber={phone}
            onPhoneNumberChange={setPhone}
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

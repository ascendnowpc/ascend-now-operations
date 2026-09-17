import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../ui/Input";
import { COUNTRY_OPTIONS } from "../../data/countries";
import { splitPhoneNumber, joinPhoneNumber } from "../../utils/phoneNumber";
import type { Parent } from "../../types/database";

// Full-screen, mandatory — shown by ParentLayout instead of the dashboard
// whenever the logged-in parent's own country or profession is still missing.
// An admin creates a parent account from a name and an email alone (that is
// all `create-parent-with-user` needs to send credentials), so a parent's
// first login is the only place these get asked. Mirrors
// TeacherCompleteProfileGate / AdminCompleteProfileGate.
//
// Only the parent's OWN details are here. Their children's profiles are a
// separate, non-blocking form reached from the dashboard
// (/parent/children/:studentId/details) — a parent shouldn't be locked out of
// seeing their child's sessions because a school name is missing.
export function ParentCompleteProfileGate({
  parent,
  updateMyParent,
}: {
  parent: Parent;
  updateMyParent: (
    fields: Partial<Pick<Parent, "country" | "profession" | "phone_number">>
  ) => Promise<{ error: string | null }>;
}) {
  const { signOut } = useAuth();
  const storedPhone = splitPhoneNumber(parent.phone_number);
  const [country, setCountry] = useState(parent.country ?? "");
  const [profession, setProfession] = useState(parent.profession ?? "");
  const [dialCode, setDialCode] = useState(storedPhone.dialCode);
  const [phone, setPhone] = useState(storedPhone.number);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!country.trim()) { setError("Country is required."); return; }
    if (!profession.trim()) { setError("Profession is required."); return; }
    if (!phone.trim()) { setError("Phone number is required."); return; }

    setSaving(true);
    setError(null);
    const { error: saveError } = await updateMyParent({
      country,
      profession: profession.trim(),
      phone_number: joinPhoneNumber(dialCode, phone),
    });
    setSaving(false);
    if (saveError) setError(saveError);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-25 px-4 py-10">
      <div className="bg-white rounded-2xl shadow-lg border border-navy-100 p-8 max-w-md w-full flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-semibold text-navy-700">Complete your profile</h2>
          <p className="text-sm text-navy-400">A few details before you continue.</p>
        </div>

        <div className="flex flex-col gap-3">
          <SelectInput
            label="Country"
            placeholder="Select a country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            options={COUNTRY_OPTIONS}
            required
          />
          <TextInput
            label="Profession"
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
            placeholder="Architect"
            required
            autoComplete="off"
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

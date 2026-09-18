import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../ui/Input";
import { COUNTRY_OPTIONS } from "../../data/countries";
import { splitPhoneNumber, joinPhoneNumber } from "../../utils/phoneNumber";
import type { Parent } from "../../types/database";

/**
 * Editing an existing parent's details — shared by the admin route
 * (`/admin/parents/:id/edit`) and the coach's (`/teacher/parents/:id/edit`),
 * so the two can't drift apart the way the admin and PC student pages once
 * did. The caller supplies the save and the navigation; this owns the fields.
 *
 * Country and profession are here but deliberately NOT on the create form:
 * an admin creates an account from a name and an email, and these two are
 * asked of the parent themselves at first login (ParentCompleteProfileGate).
 * They're editable here so a coach or admin can correct what a family tells
 * them over the phone.
 *
 * The login email on `users`/`auth.users` is deliberately untouched — changing
 * that is the update-user-email flow, and doing it silently from here would
 * break the account's own sign-in.
 */
export function ParentEditForm({
  parent,
  onSave,
  onCancel,
}: {
  parent: Parent;
  onSave: (fields: {
    first_name: string;
    last_name: string;
    email: string | null;
    phone_number: string | null;
    country: string | null;
    profession: string | null;
  }) => Promise<{ error: string | null }>;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("+971");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [profession, setProfession] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill from the row once it arrives, then leave it alone so typing isn't
  // overwritten by a later refetch.
  useEffect(() => {
    if (loaded) return;
    const split = splitPhoneNumber(parent.phone_number);
    setFirstName(parent.first_name);
    setLastName(parent.last_name);
    setEmail(parent.email ?? "");
    setDialCode(split.dialCode);
    setPhone(split.number);
    setCountry(parent.country ?? "");
    setProfession(parent.profession ?? "");
    setLoaded(true);
  }, [parent, loaded]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: saveError } = await onSave({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim() || null,
      phone_number: joinPhoneNumber(dialCode, phone),
      country: country || null,
      profession: profession.trim() || null,
    });
    setSaving(false);
    if (saveError) setError(saveError);
  }

  return (
    <Card className="p-6 max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <TextInput
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
          <TextInput
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TextInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <PhoneInput
            label="Phone number"
            dialCode={dialCode}
            onDialCodeChange={setDialCode}
            phoneNumber={phone}
            onPhoneNumberChange={setPhone}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <SelectInput
            label="Country"
            placeholder="Select a country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            options={COUNTRY_OPTIONS}
          />
          <TextInput
            label="Profession"
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 mt-2">
          <Button type="submit" disabled={saving || !firstName.trim() || !lastName.trim()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

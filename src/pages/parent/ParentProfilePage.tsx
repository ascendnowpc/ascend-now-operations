import { useState, type ReactNode } from "react";
import { ParentLayout } from "./ParentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../../components/ui/Input";
import { COUNTRY_OPTIONS } from "../../data/countries";
import { useAuth } from "../../context/AuthContext";
import { useMyParent, useMyChildren } from "../../hooks/useParents";
import { splitPhoneNumber, joinPhoneNumber } from "../../utils/phoneNumber";
import { AccountSecurityCards } from "../../components/account/AccountSecurityCards";
import type { Parent } from "../../types/database";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-navy-400 w-32 shrink-0">{label}</dt>
      <dd className="text-navy-700 font-medium break-all">{value ?? <span className="text-navy-300 italic">—</span>}</dd>
    </div>
  );
}

// Country, profession and phone — the three fields a parent owns themselves,
// collected by the first-login gate and correctable here afterward. Everything
// else on the account (id, name, email) is admin-maintained, so it stays in
// the read-only card above this one.
function YourDetailsSection({
  parent,
  updateMyParent,
}: {
  parent: Parent;
  updateMyParent: (
    fields: Partial<Pick<Parent, "country" | "profession" | "phone_number">>
  ) => Promise<{ error: string | null }>;
}) {
  const [editing, setEditing] = useState(false);
  const [country, setCountry] = useState(parent.country ?? "");
  const [profession, setProfession] = useState(parent.profession ?? "");
  const stored = splitPhoneNumber(parent.phone_number);
  const [dialCode, setDialCode] = useState(stored.dialCode);
  const [phone, setPhone] = useState(stored.number);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    const split = splitPhoneNumber(parent.phone_number);
    setCountry(parent.country ?? "");
    setProfession(parent.profession ?? "");
    setDialCode(split.dialCode);
    setPhone(split.number);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!country.trim()) { setError("Country is required."); return; }
    if (!profession.trim()) { setError("Profession is required."); return; }
    setSaving(true);
    setError(null);
    const { error: saveError } = await updateMyParent({
      country,
      profession: profession.trim(),
      phone_number: joinPhoneNumber(dialCode, phone),
    });
    setSaving(false);
    if (saveError) { setError(saveError); return; }
    setEditing(false);
  }

  if (!editing) {
    return (
      <>
        <div className="flex items-center justify-between mb-4">
          <p className="text-lg font-semibold text-navy-700">Your Details</p>
          <button onClick={startEdit} className="text-sm text-sky-500 hover:text-sky-700">Edit</button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <InfoRow label="Country" value={parent.country} />
          <InfoRow label="Profession" value={parent.profession} />
          <InfoRow label="Phone" value={parent.phone_number} />
        </dl>
      </>
    );
  }

  return (
    <>
      <p className="text-lg font-semibold text-navy-700 mb-4">Your Details</p>
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
        />
        <PhoneInput
          label="Phone number"
          dialCode={dialCode}
          onDialCodeChange={setDialCode}
          phoneNumber={phone}
          onPhoneNumberChange={setPhone}
        />
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-3 mt-1">
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    </>
  );
}

/**
 * The parent's own account page, reached from the sidebar footer's identity
 * block like every other role's.
 *
 * Name and email stay admin-maintained from /admin/parents/:id/edit, the same
 * way a student's details are, so a family's contact info has one home rather
 * than two that can disagree. Country, profession and phone are the parent's
 * own to keep current — they're asked for at first login and nowhere else.
 */
export default function ParentProfilePage() {
  const { session, profile, updateUsername, updatePassword } = useAuth();
  const { parent, loading: parentLoading, updateMyParent } = useMyParent(session?.user?.id);
  const { children, loading: childrenLoading } = useMyChildren(parent?.id);

  return (
    <ParentLayout loading={parentLoading || childrenLoading}>
      <PageHeader title="Profile" />

      <div className="max-w-3xl flex flex-col gap-5">
        <Card className="p-8">
          <p className="text-lg font-semibold text-navy-700 mb-6">Your Information</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Parent ID" value={parent?.id} />
            <InfoRow label="Username" value={profile?.username} />
            <InfoRow label="First name" value={parent?.first_name} />
            <InfoRow label="Last name" value={parent?.last_name} />
            <InfoRow label="Email" value={parent?.email ?? profile?.email} />
            <InfoRow
              label="Children"
              value={
                children.length > 0
                  ? children.map((c) => `${c.first_name} ${c.last_name}`.trim()).join(", ")
                  : null
              }
            />
          </dl>
        </Card>

        {parent && (
          <Card className="p-8">
            <YourDetailsSection parent={parent} updateMyParent={updateMyParent} />
          </Card>
        )}

        <AccountSecurityCards
          username={profile?.username}
          updateUsername={updateUsername}
          updatePassword={updatePassword}
        />
      </div>
    </ParentLayout>
  );
}

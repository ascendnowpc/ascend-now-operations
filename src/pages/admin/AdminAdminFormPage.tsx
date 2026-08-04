import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { useUsers } from "../../hooks/useUsers";
import { useAdmins } from "../../hooks/useAdmins";
import { invokeEdgeFunction, describeFunctionError } from "../../lib/edgeFunctions";
import { COUNTRY_OPTIONS, COUNTRY_DIAL_CODES } from "../../data/countries";
import { splitPhoneNumber, joinPhoneNumber } from "../../utils/phoneNumber";
import type { AppUser, Admin } from "../../types/database";

interface FormValues {
  fullName: string;
  email: string;
  country: string;
  dialCode: string;
  phoneNumber: string;
}

// What the fields show before anything is typed: whatever has loaded so far.
function loadedValues(user: AppUser | null, admin: Admin | null): FormValues {
  const { dialCode, number } = splitPhoneNumber(admin?.phone_number);
  return {
    fullName: user?.full_name ?? "",
    email: user?.email ?? "",
    country: admin?.country ?? "",
    dialCode,
    phoneNumber: number,
  };
}

/**
 * Edit one admin's details, on its own route (/admin/admins/:userId/edit)
 * rather than as a panel inside the admins list — same shape as editing a
 * teacher via /admin/teachers/:id/edit.
 *
 * `:userId` is the auth user id (public.users.id), which is what links the
 * users row to the admins row; admins.id is the mnemonic display id and is
 * never used for routing.
 */
export default function AdminAdminFormPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { users, loading: usersLoading, updateUser } = useUsers();
  const { admins, loading: adminsLoading, updateAdminByUserId } = useAdmins();

  const user = users.find((u) => u.id === userId && u.role === "admin") ?? null;
  const adminRecord = admins.find((a) => a.user_id === userId) ?? null;
  const loading = usersLoading || adminsLoading;

  // Form state stays null until something is edited, so the fields simply
  // read from the rows as they arrive (users and admins load independently)
  // without an effect copying one into the other.
  const [form, setForm] = useState<FormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const values = form ?? loadedValues(user, adminRecord);
  const { fullName, email, country, dialCode, phoneNumber } = values;
  function update(patch: Partial<FormValues>) {
    setForm({ ...values, ...patch });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!fullName.trim()) { setError("Full name is required."); return; }
    setSaving(true);
    setError(null);

    const trimmedEmail = email.trim();

    // Email change goes through update-user-email first (targeting the edited
    // admin's user id) so a failure — e.g. address already taken — aborts the
    // save before name/contact fields are touched, the same ordering
    // AdminProfilePage / AdminTeacherFormPage use for the same reason.
    if (trimmedEmail && trimmedEmail.toLowerCase() !== user.email.toLowerCase()) {
      const { data, error: invokeErr } = await invokeEdgeFunction(
        "update-user-email",
        { body: { newEmail: trimmedEmail, targetUserId: user.id } }
      );
      const emailMessage = invokeErr
        ? await describeFunctionError(invokeErr)
        : (data as { error?: string } | null)?.error ?? null;
      if (emailMessage) { setSaving(false); setError(emailMessage); return; }
    }

    if (fullName.trim() !== (user.full_name ?? "")) {
      const { error: userErr } = await updateUser(user.id, { full_name: fullName.trim() });
      if (userErr) { setSaving(false); setError(userErr); return; }
    }

    const { error: adminErr } = await updateAdminByUserId(user.id, {
      country: country || null,
      phone_number: joinPhoneNumber(dialCode, phoneNumber),
    });
    setSaving(false);
    if (adminErr) { setError(adminErr); return; }

    navigate("/admin/admins");
  }

  return (
    <AdminLayout>
      <PageHeader title={user ? `Edit ${user.full_name || user.username}` : "Edit admin"} />

      {loading && <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>}

      {!loading && !user && (
        <Card className="p-6 max-w-2xl">
          <p className="text-sm text-navy-500">That admin no longer exists.</p>
          <Button className="mt-4" variant="ghost" onClick={() => navigate("/admin/admins")}>
            Back to admins
          </Button>
        </Card>
      )}

      {!loading && user && (
        <Card className="p-6 max-w-2xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextInput
              label="Full name"
              value={fullName}
              onChange={(e) => update({ fullName: e.target.value })}
              required
            />

            <SelectInput
              label="Country"
              placeholder="Select a country"
              value={country}
              onChange={(e) => {
                const next = e.target.value;
                update({ country: next, ...(COUNTRY_DIAL_CODES[next] ? { dialCode: COUNTRY_DIAL_CODES[next] } : {}) });
              }}
              options={COUNTRY_OPTIONS}
            />

            <div className="grid grid-cols-2 gap-4">
              <TextInput
                label="Email"
                type="email"
                value={email}
                onChange={(e) => update({ email: e.target.value })}
                required
              />
              <PhoneInput
                label="Phone number"
                dialCode={dialCode}
                onDialCodeChange={(next) => update({ dialCode: next })}
                phoneNumber={phoneNumber}
                onPhoneNumberChange={(next) => update({ phoneNumber: next })}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 mt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/admin/admins")}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </AdminLayout>
  );
}

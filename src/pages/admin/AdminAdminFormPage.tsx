import { useEffect, useRef, useState, type FormEvent } from "react";
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

// What the edit fields show before anything is typed: whatever has loaded so
// far. The two rows load independently, so this reads from each as it arrives
// instead of an effect copying one into the other.
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
 * Add an admin (/admin/admins/new) or edit one (/admin/admins/:userId/edit),
 * each on its own route rather than as a panel inside the admins list — the
 * same shape as /admin/teachers/new and /admin/teachers/:id/edit.
 *
 * `:userId` is the auth user id (public.users.id), which is what links the
 * users row to the admins row; admins.id is the mnemonic display id and is
 * never used for routing.
 *
 * Create mode is the fuller form: it also collects the first/last name split
 * and the login account (username + password) the `create-admin-with-user`
 * edge function needs. Edit mode never touches username/password — those stay
 * self-service on that admin's own /admin/profile.
 */
export default function AdminAdminFormPage() {
  const { userId } = useParams<{ userId: string }>();
  const isEditing = Boolean(userId);
  const navigate = useNavigate();
  const { users, loading: usersLoading, updateUser, refetch } = useUsers();
  const { admins, loading: adminsLoading, updateAdminByUserId, refetch: refetchAdmins } = useAdmins();

  const user = isEditing ? users.find((u) => u.id === userId && u.role === "admin") ?? null : null;
  const adminRecord = isEditing ? admins.find((a) => a.user_id === userId) ?? null : null;
  const loading = isEditing && (usersLoading || adminsLoading);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Edit mode fields ──
  const [form, setForm] = useState<FormValues | null>(null);
  const values = form ?? loadedValues(user, adminRecord);
  const { fullName, email, country, dialCode, phoneNumber } = values;
  function update(patch: Partial<FormValues>) {
    setForm({ ...values, ...patch });
  }

  // ── Create mode fields ──
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newDialCode, setNewDialCode] = useState("+1");
  const [newPhone, setNewPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Track whether the user has manually overridden the auto-filled values
  const usernameManualRef = useRef(false);
  const passwordManualRef = useRef(false);

  // Auto-fill username from email (unless manually overridden)
  useEffect(() => {
    if (usernameManualRef.current) return;
    setUsername(newEmail.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, ""));
  }, [newEmail]);

  // Auto-fill password from first name (unless manually overridden)
  useEffect(() => {
    if (passwordManualRef.current) return;
    if (firstName.trim()) setPassword(`${firstName.trim().toLowerCase()}@ascendnow`);
  }, [firstName]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { data, error: invokeErr } = await invokeEdgeFunction<{ data: { id: number } }>(
      "create-admin-with-user",
      {
        body: {
          username,
          email: newEmail,
          password,
          first_name: firstName,
          last_name: lastName,
          country: newCountry || null,
          phone_number: joinPhoneNumber(newDialCode, newPhone),
        },
      }
    );
    setSaving(false);

    const resultError = invokeErr
      ? await describeFunctionError(invokeErr)
      : (data as { error?: string } | null)?.error;
    if (resultError) { setError(resultError); return; }

    refetch();
    refetchAdmins();
    // The list renders this banner — see AdminAdminsPage.
    navigate("/admin/admins", {
      state: {
        notice: `Admin account created for ${firstName}${lastName ? " " + lastName : ""}. Their login details were emailed to ${newEmail}.`,
      },
    });
  }

  async function handleEdit(e: FormEvent) {
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

    navigate("/admin/admins", {
      state: { notice: `Updated ${fullName.trim()}'s details.` },
    });
  }

  const errorBox = error && (
    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
      {error}
    </p>
  );

  const cancelButton = (
    <Button type="button" variant="ghost" onClick={() => navigate("/admin/admins")}>
      Cancel
    </Button>
  );

  return (
    <AdminLayout>
      <PageHeader
        title={isEditing ? (user ? `Edit ${user.full_name || user.username}` : "Edit admin") : "Add admin"}
      />

      {loading && <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>}

      {isEditing && !loading && !user && (
        <Card className="p-6 max-w-2xl">
          <p className="text-sm text-navy-500">That admin no longer exists.</p>
          <Button className="mt-4" variant="ghost" onClick={() => navigate("/admin/admins")}>
            Back to admins
          </Button>
        </Card>
      )}

      {!isEditing && (
        <Card className="p-6 max-w-2xl">
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
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

            <SelectInput
              label="Country"
              placeholder="Select a country"
              value={newCountry}
              onChange={(e) => {
                const next = e.target.value;
                setNewCountry(next);
                const dial = COUNTRY_DIAL_CODES[next];
                if (dial) setNewDialCode(dial);
              }}
              options={COUNTRY_OPTIONS}
            />

            <div className="grid grid-cols-2 gap-4">
              <TextInput
                label="Email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
              <PhoneInput
                label="Phone number"
                dialCode={newDialCode}
                onDialCodeChange={setNewDialCode}
                phoneNumber={newPhone}
                onPhoneNumberChange={setNewPhone}
              />
            </div>

            <hr className="border-navy-50 my-1" />
            <p className="text-sm font-semibold text-navy-700">
              Login account
              <span className="text-xs font-normal text-navy-300 ml-2">
                Auto-filled from name &amp; email — you can still edit
              </span>
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextInput
                label="Username"
                value={username}
                onChange={(e) => {
                  usernameManualRef.current = true;
                  setUsername(e.target.value);
                }}
                required
                placeholder="e.g. john.doe"
              />
              <TextInput
                label="Password"
                type="text"
                value={password}
                onChange={(e) => {
                  passwordManualRef.current = true;
                  setPassword(e.target.value);
                }}
                required
                placeholder="Minimum 6 characters"
              />
            </div>

            {errorBox}

            <div className="flex gap-3 mt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create admin"}
              </Button>
              {cancelButton}
            </div>
          </form>
        </Card>
      )}

      {isEditing && !loading && user && (
        <Card className="p-6 max-w-2xl">
          <form onSubmit={handleEdit} className="flex flex-col gap-4">
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

            {errorBox}

            <div className="flex gap-3 mt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {cancelButton}
            </div>
          </form>
        </Card>
      )}
    </AdminLayout>
  );
}

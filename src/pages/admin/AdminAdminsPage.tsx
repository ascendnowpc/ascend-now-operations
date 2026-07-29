import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { IconPlus } from "../../components/ui/icons";
import { useUsers } from "../../hooks/useUsers";
import { useAdmins } from "../../hooks/useAdmins";
import { invokeEdgeFunction, describeFunctionError } from "../../lib/edgeFunctions";
import { COUNTRY_OPTIONS, COUNTRY_DIAL_CODES } from "../../data/countries";
import type { AppUser } from "../../types/database";

type AdminRow = AppUser & { admin_id: string | null; admin_phone: string | null; admin_country: string | null };

export default function AdminAdminsPage() {
  const { users, loading, refetch, updateUser } = useUsers();
  const { admins: adminRecords, refetch: refetchAdmins, updateAdminByUserId } = useAdmins();

  // admins.phone_number/country live on the admins table, not users — merge
  // by user_id onto the users-table rows below.
  // (`id` too — the mnemonic admins.id, e.g. ARIS26-2; AppUser.id is the
  // auth uuid, which is not the id shown anywhere else in the app.)
  const adminExtras: Record<string, { id: string; phone_number: string | null; country: string | null }> = {};
  for (const a of adminRecords) {
    adminExtras[a.user_id] = { id: a.id, phone_number: a.phone_number, country: a.country };
  }

  const admins: AdminRow[] = users
    .filter((u) => u.role === "admin")
    .map((u) => ({
      ...u,
      admin_id: adminExtras[u.id]?.id ?? null,
      admin_phone: adminExtras[u.id]?.phone_number ?? null,
      admin_country: adminExtras[u.id]?.country ?? null,
    }));

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");

  const q = search.trim().toLowerCase();
  const filteredAdmins = admins.filter((u) => {
    const matchesSearch =
      !q ||
      u.username.toLowerCase().includes(q) ||
      (u.full_name ?? "").toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
    const matchesStatus =
      !statusFilter || (statusFilter === "active" ? u.is_active : !u.is_active);
    return matchesSearch && matchesStatus;
  });

  const activeFilterCount = [statusFilter].filter(Boolean).length;
  function clearFilters() {
    setStatusFilter("");
  }

  const [showForm, setShowForm] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [dialCode, setDialCode] = useState("+1");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Track whether the user has manually overridden the auto-filled values
  const usernameManualRef = useRef(false);
  const passwordManualRef = useRef(false);

  // Auto-fill username from email (unless manually overridden)
  useEffect(() => {
    if (usernameManualRef.current) return;
    const derived = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
    setUsername(derived);
  }, [email]);

  // Auto-fill password from first name (unless manually overridden)
  useEffect(() => {
    if (passwordManualRef.current) return;
    if (firstName.trim()) setPassword(`${firstName.trim().toLowerCase()}@ascendnow`);
  }, [firstName]);

  function resetForm() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setCountry("");
    setDialCode("+1");
    setPhoneNumber("");
    setUsername("");
    setPassword("");
    usernameManualRef.current = false;
    passwordManualRef.current = false;
    setError(null);
  }

  // ── Edit an existing admin (any admin can edit any admin's details) ──
  const [editingAdmin, setEditingAdmin] = useState<AdminRow | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editDialCode, setEditDialCode] = useState("+1");
  const [editPhoneNumber, setEditPhoneNumber] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit(admin: AdminRow) {
    setShowForm(false);
    setSuccess(null);
    setEditFullName(admin.full_name ?? "");
    setEditEmail(admin.email);
    setEditCountry(admin.admin_country ?? "");
    // Parse stored phone back into dial code + number if it starts with +
    const stored = admin.admin_phone ?? "";
    const match = stored.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match) { setEditDialCode(match[1]); setEditPhoneNumber(match[2]); }
    else { setEditDialCode("+1"); setEditPhoneNumber(stored); }
    setEditError(null);
    setEditingAdmin(admin);
  }

  function cancelEdit() {
    setEditingAdmin(null);
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingAdmin) return;
    if (!editFullName.trim()) { setEditError("Full name is required."); return; }
    setEditSaving(true);
    setEditError(null);

    const trimmedEmail = editEmail.trim();

    // Email change goes through update-user-email first (targeting the
    // edited admin's user id) so a failure — e.g. address already taken —
    // aborts the save before name/contact fields are touched, same ordering
    // AdminProfilePage/AdminTeacherFormPage use for the same reason.
    if (trimmedEmail && trimmedEmail.toLowerCase() !== editingAdmin.email.toLowerCase()) {
      const { data, error: invokeErr } = await invokeEdgeFunction(
        "update-user-email",
        { body: { newEmail: trimmedEmail, targetUserId: editingAdmin.id } }
      );
      const emailMessage = invokeErr
        ? await describeFunctionError(invokeErr)
        : (data as { error?: string } | null)?.error ?? null;
      if (emailMessage) { setEditSaving(false); setEditError(emailMessage); return; }
    }

    if (editFullName.trim() !== (editingAdmin.full_name ?? "")) {
      const { error } = await updateUser(editingAdmin.id, { full_name: editFullName.trim() });
      if (error) { setEditSaving(false); setEditError(error); return; }
    }

    const fullPhone = editPhoneNumber.trim() ? `${editDialCode} ${editPhoneNumber.trim()}` : null;
    const { error: adminErr } = await updateAdminByUserId(editingAdmin.id, {
      country: editCountry || null,
      phone_number: fullPhone,
    });
    setEditSaving(false);
    if (adminErr) { setEditError(adminErr); return; }

    setSuccess(`Updated ${editFullName.trim()}'s details.`);
    setEditingAdmin(null);
    refetch();
    refetchAdmins();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const { data, error: invokeErr } = await invokeEdgeFunction<{ data: { id: number } }>(
      "create-admin-with-user",
      {
        body: {
          username,
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          country: country || null,
          phone_number: phoneNumber.trim() ? `${dialCode} ${phoneNumber.trim()}` : null,
        },
      }
    );
    setSaving(false);

    const resultError = invokeErr ? await describeFunctionError(invokeErr) : (data as { error?: string } | null)?.error;
    if (resultError) {
      setError(resultError);
      return;
    }

    setSuccess(`Admin account created for ${firstName}${lastName ? " " + lastName : ""}. Their login details were emailed to ${email}.`);
    resetForm();
    setShowForm(false);
    refetch();
  }

  const columns: ColumnDef<AdminRow>[] = [
    { header: "ID", accessor: (u) => u.admin_id ?? "—", className: "whitespace-nowrap" },
    { header: "Username", accessor: (u) => u.username },
    { header: "Full name", accessor: (u) => u.full_name ?? "—" },
    { header: "Email", accessor: (u) => u.email },
    { header: "Country", accessor: (u) => u.admin_country ?? "—" },
    { header: "Phone", accessor: (u) => u.admin_phone ?? "—", className: "whitespace-nowrap" },
    {
      header: "Status",
      accessor: (u) => (
        <span
          className={`inline-block rounded-pill px-3 py-0.5 text-xs font-semibold ${
            u.is_active ? "bg-lime-100 text-lime-600" : "bg-navy-50 text-navy-300"
          }`}
        >
          {u.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Admins"
        description="Everyone with admin access to the platform. Add a new admin and create their login account in one step."
        action={
          <Button
            onClick={() => {
              setShowForm((v) => !v);
              setSuccess(null);
              setEditingAdmin(null);
              if (showForm) resetForm();
            }}
            className="flex items-center gap-2"
          >
            <IconPlus /> {showForm ? "Cancel" : "Add admin"}
          </Button>
        }
      />

      {success && (
        <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2 mb-4">
          {success}
        </p>
      )}

      {showForm && (
        <Card className="p-6 max-w-2xl mb-6">
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
            />

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
                phoneNumber={phoneNumber}
                onPhoneNumberChange={setPhoneNumber}
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

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 mt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create admin"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {editingAdmin && (
        <Card className="p-6 max-w-2xl mb-6">
          <p className="text-sm font-semibold text-navy-700 mb-4">
            Editing {editingAdmin.full_name || editingAdmin.username}
          </p>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
            <TextInput
              label="Full name"
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              required
            />

            <SelectInput
              label="Country"
              placeholder="Select a country"
              value={editCountry}
              onChange={(e) => {
                const next = e.target.value;
                setEditCountry(next);
                const dial = COUNTRY_DIAL_CODES[next];
                if (dial) setEditDialCode(dial);
              }}
              options={COUNTRY_OPTIONS}
            />

            <div className="grid grid-cols-2 gap-4">
              <TextInput
                label="Email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                required
              />
              <PhoneInput
                label="Phone number"
                dialCode={editDialCode}
                onDialCodeChange={setEditDialCode}
                phoneNumber={editPhoneNumber}
                onPhoneNumberChange={setEditPhoneNumber}
              />
            </div>

            {editError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {editError}
              </p>
            )}

            <div className="flex gap-3 mt-2">
              <Button type="submit" disabled={editSaving}>
                {editSaving ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <TextInput
              label="Search"
              placeholder="Search by username, name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | "active" | "inactive")}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="mt-3 text-sm text-navy-400 hover:text-red-500">
            Clear filters
          </button>
        )}
      </Card>

      <p className="text-xs text-navy-400 mb-2">{filteredAdmins.length} of {admins.length} admins</p>

      <DataTable columns={columns} rows={filteredAdmins} getRowId={(u) => u.id} loading={loading} onEdit={openEdit} />
    </AdminLayout>
  );
}

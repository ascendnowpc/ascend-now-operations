import { useState, type FormEvent, type ReactNode } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { useAuth } from "../../context/AuthContext";
import { useAdmins } from "../../hooks/useAdmins";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 border-b border-navy-50 last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-navy-300">{label}</span>
      <span className="text-sm text-navy-700">{value ?? <span className="text-navy-300">—</span>}</span>
    </div>
  );
}

// An admin's account details live entirely on the public.users row
// (full_name / username / email) plus the Auth password — there is no
// separate admin profile table (the `admins` row is just a marker). So this
// page is a slimmer version of TeacherProfilePage: name + email inline edit,
// plus username and password change cards.
export default function AdminProfilePage() {
  const { profile, loading, updateFullName, updateEmail, updateUsername, updatePassword } = useAuth();
  // The `admins` marker row carries this admin's own mnemonic id (e.g.
  // ARIS26-2) — `profile.id` is the auth uuid, not the id used anywhere else.
  const { admins } = useAdmins();
  const adminId = admins.find((a) => a.user_id === profile?.id)?.id ?? null;

  // ── Personal information ──
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function startEdit() {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setEmail(profile.email ?? "");
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!fullName.trim()) { setSaveError("Full name is required."); return; }
    setSaving(true);
    setSaveError(null);

    const trimmedEmail = email.trim();

    // Email change goes through updateEmail (the update-user-email edge
    // function), which syncs the Auth login credential + public.users.email
    // together. Do it FIRST so a failure (e.g. address already taken) aborts
    // the save before the name is touched.
    if (trimmedEmail && trimmedEmail.toLowerCase() !== (profile?.email ?? "").toLowerCase()) {
      const { error: emailError } = await updateEmail(trimmedEmail);
      if (emailError) { setSaving(false); setSaveError(emailError); return; }
    }

    if (fullName.trim() !== (profile?.full_name ?? "")) {
      const { error } = await updateFullName(fullName.trim());
      if (error) { setSaving(false); setSaveError(error); return; }
    }

    setSaving(false);
    setEditing(false);
  }

  // ── Username ──
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  async function handleUsernameSubmit(e: FormEvent) {
    e.preventDefault();
    setUsernameError(null);
    const trimmed = newUsername.trim();
    if (!trimmed) return;
    setUsernameLoading(true);
    const { error } = await updateUsername(trimmed);
    setUsernameLoading(false);
    if (error) { setUsernameError(error); return; }
    setNewUsername("");
    setUsernameOpen(false);
  }

  // ── Password ──
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword.length < 6) { setPasswordError("Password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("Passwords do not match."); return; }
    setPasswordLoading(true);
    const { error } = await updatePassword(newPassword);
    setPasswordLoading(false);
    if (error) { setPasswordError(error); return; }
    setPasswordSuccess(true);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordOpen(false);
  }

  const displayName = profile?.full_name?.trim() || profile?.username || "";
  const initials = (profile?.full_name ?? profile?.username ?? "")
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <AdminLayout>
      <PageHeader title="My Profile" description="Your account details and login settings." />

      {loading && <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>}

      {!loading && profile && (
        <div className="max-w-xl flex flex-col gap-5">
          {/* Identity header */}
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                <span className="text-2xl font-bold text-sky-500">{initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-navy-800 truncate">{displayName}</p>
                <p className="text-sm text-navy-400">Admin</p>
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
                <InfoRow label="ID" value={adminId} />
                <InfoRow label="Full name" value={profile.full_name} />
                <InfoRow label="Email" value={profile.email} />
              </dl>
            ) : (
              <div className="flex flex-col gap-4">
                <TextInput label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

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

          {/* Username */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5">
              <div>
                <p className="text-sm font-semibold text-navy-700">Username</p>
                <p className="text-xs text-navy-400 mt-0.5">
                  Current: <span className="font-medium text-navy-600">{profile.username}</span>
                </p>
              </div>
              {!usernameOpen && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => { setUsernameOpen(true); setUsernameError(null); setNewUsername(""); }}
                >
                  Change
                </Button>
              )}
            </div>
            {usernameOpen && (
              <form onSubmit={handleUsernameSubmit} className="px-6 pb-6 border-t border-navy-50 pt-4 flex flex-col gap-3">
                <TextInput
                  label="New username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter new username"
                  required
                  autoFocus
                />
                {usernameError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{usernameError}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={usernameLoading || !newUsername.trim()}>
                    {usernameLoading ? "Saving…" : "Update"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setUsernameOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </Card>

          {/* Password */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5">
              <div>
                <p className="text-sm font-semibold text-navy-700">Password</p>
                <p className="text-xs text-navy-400 mt-0.5">Update your login password</p>
              </div>
              {!passwordOpen && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => { setPasswordOpen(true); setPasswordSuccess(false); setPasswordError(null); setNewPassword(""); setConfirmPassword(""); }}
                >
                  Change
                </Button>
              )}
            </div>
            {passwordOpen && (
              <form onSubmit={handlePasswordSubmit} className="px-6 pb-6 border-t border-navy-50 pt-4 flex flex-col gap-3">
                <TextInput
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  autoFocus
                />
                <TextInput
                  label="Confirm new password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  required
                />
                {passwordError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{passwordError}</p>}
                {passwordSuccess && <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">Password updated.</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={passwordLoading}>
                    {passwordLoading ? "Saving…" : "Update"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPasswordOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}

import { useState, type FormEvent } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/Input";

// The "Username" + "Password" change cards — shared by every role's own
// account page (teacher/student/parent "My Profile", and the coach's merged
// profile page). Talks directly to AuthContext's updateUsername/
// updatePassword, so it's usable regardless of what other account fields
// the host page manages.
export function AccountSecurityCards({
  username,
  updateUsername,
  updatePassword,
}: {
  username: string | undefined;
  updateUsername: (newUsername: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
}) {
  // ── Username ──
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  async function handleUsernameSubmit(e: FormEvent) {
    e.preventDefault();
    setUsernameError(null);
    setUsernameSuccess(false);
    const trimmed = newUsername.trim();
    if (!trimmed) return;
    setUsernameLoading(true);
    const { error } = await updateUsername(trimmed);
    setUsernameLoading(false);
    if (error) { setUsernameError(error); return; }
    setUsernameSuccess(true);
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

  return (
    <>
      {/* Username */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-navy-700">Username</p>
            <p className="text-xs text-navy-400 mt-0.5">
              Current: <span className="font-medium text-navy-600">{username}</span>
            </p>
          </div>
          {!usernameOpen && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { setUsernameOpen(true); setUsernameSuccess(false); setUsernameError(null); setNewUsername(""); }}
            >
              Change
            </Button>
          )}
        </div>
        {usernameOpen && (
          <form onSubmit={handleUsernameSubmit} className="px-5 pb-5 border-t border-navy-50 pt-4 flex flex-col gap-3">
            <TextInput
              label="New username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Enter new username"
              required
              autoFocus
            />
            {usernameError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{usernameError}</p>}
            {usernameSuccess && <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">Username updated.</p>}
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
        <div className="flex items-center justify-between px-5 py-4">
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
          <form onSubmit={handlePasswordSubmit} className="px-5 pb-5 border-t border-navy-50 pt-4 flex flex-col gap-3">
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
    </>
  );
}

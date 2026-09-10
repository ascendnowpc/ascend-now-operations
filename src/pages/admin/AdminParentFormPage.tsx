import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, PhoneInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { useParents, invalidateParentsCache } from "../../hooks/useParents";
import { invokeEdgeFunction, describeFunctionError } from "../../lib/edgeFunctions";
import { splitPhoneNumber, joinPhoneNumber } from "../../utils/phoneNumber";
import { findParentByEmail, parentDisplayName } from "../../utils/parentDirectory";
import type { Parent } from "../../types/database";

/**
 * Add a parent (/admin/parents/new) or edit one (/admin/parents/:id/edit),
 * each on its own route rather than as a panel inside the parents list.
 *
 * Create collects only what a parent account actually needs — first name,
 * last name, email — plus an optional phone. The login is derived and the
 * credentials emailed by the `create-parent-with-user` edge function, so an
 * admin never picks a username or password here.
 *
 * `?returnTo=` lets the enroll form send an admin here mid-enrollment to add
 * a family that isn't in the system yet; on save it goes back there with the
 * new parent preselected (`?parent=<id>`) instead of landing on the list.
 */
export default function AdminParentFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  const { parents, loading, updateParent, refetch } = useParents();
  const existing: Parent | null = isEditing ? parents.find((p) => p.id === id) ?? null : null;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("+971");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill the edit form once the row arrives, then leave it alone so typing
  // isn't overwritten by a later refetch.
  useEffect(() => {
    if (!existing || loaded) return;
    const split = splitPhoneNumber(existing.phone_number);
    setFirstName(existing.first_name);
    setLastName(existing.last_name);
    setEmail(existing.email ?? "");
    setDialCode(split.dialCode);
    setPhone(split.number);
    setLoaded(true);
  }, [existing, loaded]);

  // Warn before submitting when the address already belongs to a family —
  // adding a sibling means picking that parent, not making a second account.
  // The edge function enforces the same rule server-side.
  const duplicate = isEditing ? null : findParentByEmail(parents, email);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (duplicate) return;
    setSaving(true);
    setError(null);

    const { data, error: invokeErr } = await invokeEdgeFunction<{
      data?: { parent: Parent };
      error?: string;
    }>("create-parent-with-user", {
      body: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone_number: joinPhoneNumber(dialCode, phone),
      },
    });
    setSaving(false);

    const resultError = invokeErr ? await describeFunctionError(invokeErr) : data?.error;
    if (resultError) { setError(resultError); return; }

    const created = data?.data?.parent;
    // The edge function wrote the row straight to the database, so the cached
    // list this hook is holding knows nothing about it — drop it before the
    // refetch, or the list we navigate back to serves a stale result.
    invalidateParentsCache();
    refetch();

    const notice = `Parent account created for ${firstName.trim()} ${lastName.trim()}${
      created ? ` (${created.id})` : ""
    }. Their login details were emailed to ${email.trim()}.`;

    // Mid-enrollment: hand the admin back to the form they came from with the
    // parent they just created already selected.
    if (returnTo && created) {
      const sep = returnTo.includes("?") ? "&" : "?";
      navigate(`${returnTo}${sep}parent=${encodeURIComponent(created.id)}`, { state: { notice } });
      return;
    }
    navigate("/admin/parents", { state: { notice } });
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!existing) return;
    setSaving(true);
    setError(null);

    // Only the parents row is edited here. The login email on `users` /
    // `auth.users` is deliberately not touched — changing that is the
    // update-user-email flow, and doing it silently from this form would
    // break the account's own sign-in (username resolves through it).
    const { error: updateErr } = await updateParent(existing.id, {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim() || null,
      phone_number: joinPhoneNumber(dialCode, phone),
    });
    setSaving(false);
    if (updateErr) { setError(updateErr); return; }

    navigate("/admin/parents", {
      state: { notice: `Updated ${firstName.trim()} ${lastName.trim()}'s details.` },
    });
  }

  const canSubmit = Boolean(firstName.trim() && lastName.trim() && email.trim()) && !duplicate;

  const errorBox = error && (
    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
      {error}
    </p>
  );

  const nameFields = (
    <>
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
    </>
  );

  return (
    <AdminLayout>
      <PageHeader
        title={isEditing ? (existing ? `Edit ${parentDisplayName(existing)}` : "Edit parent") : "Add parent"}
      />

      {isEditing && loading && !existing && (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      )}

      {isEditing && !loading && !existing && (
        <Card className="p-6 max-w-2xl">
          <p className="text-sm text-navy-500">That parent no longer exists.</p>
          <Button className="mt-4" variant="ghost" onClick={() => navigate("/admin/parents")}>
            Back to parents
          </Button>
        </Card>
      )}

      {!isEditing && (
        <Card className="p-6 max-w-2xl">
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            {nameFields}

            {duplicate && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {parentDisplayName(duplicate)} ({duplicate.id}) already uses this email. Pick them on
                the student's enrollment instead of creating a second account.
              </p>
            )}

            {errorBox}

            <div className="flex gap-3 mt-2">
              <Button type="submit" disabled={saving || !canSubmit}>
                {saving ? "Creating…" : "Create parent"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate(returnTo ?? "/admin/parents")}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isEditing && existing && (
        <Card className="p-6 max-w-2xl">
          <form onSubmit={handleEdit} className="flex flex-col gap-4">
            {nameFields}
            {errorBox}
            <div className="flex gap-3 mt-2">
              <Button type="submit" disabled={saving || !firstName.trim() || !lastName.trim()}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/admin/parents")}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </AdminLayout>
  );
}

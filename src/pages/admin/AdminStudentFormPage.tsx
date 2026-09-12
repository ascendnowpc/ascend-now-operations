import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { ParentPicker } from "../../components/students/ParentPicker";
import { useTeachers } from "../../hooks/useTeachers";
import { invokeEdgeFunction, describeFunctionError } from "../../lib/edgeFunctions";
import { invalidateCachePrefix } from "../../lib/cache";
import type { Student } from "../../types/database";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Add a student (/admin/students/new).
 *
 * The one way a student gets into the system: a form, a login, credentials
 * emailed, done — exactly like adding a teacher or an admin. `/admin/students/
 * enroll` raises an invoice and only creates the student once a payment is
 * confirmed; that flow is intact but switched off (INVOICE_PAYMENT_FLOW_ENABLED,
 * utils/enrollmentFlow.ts), and it is the right one when money is changing
 * hands.
 *
 * Asks for the five things a student record cannot do without — both names, the
 * email that becomes their login, their coach, and the household — and nothing
 * else. Curriculum, school, phone, address and the rest are the student's own to
 * fill in at first login (StudentCompleteProfileGate); asking an admin to type
 * them here only creates two places for the same fact to be wrong.
 *
 * No hours are bought here. A package belongs to a student who already exists,
 * so it is its own form — /admin/packages/new, which can give the hours to this
 * student alone or share them with one of their siblings.
 */
export default function AdminStudentFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { teachers } = useTeachers();

  const coaches = teachers.filter((t) => t.is_performance_coach && t.is_active);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [pcTeacherId, setPcTeacherId] = useState("");
  // Returning from "+ New parent" is a real navigation, so this mounts fresh
  // with ?parent=<id> — read it as the initial value rather than syncing it in
  // with an effect.
  const [parentId, setParentId] = useState<string | null>(searchParams.get("parent"));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());
  // Both names are required. The surname is half of how a student is
  // identified — it seeds the mnemonic id, and every list, report and invoice
  // reads "First Last" — so a blank one is never the right record to create.
  // `create-student-with-user` enforces the same thing server-side.
  const canSubmit = Boolean(firstName.trim()) && Boolean(lastName.trim()) && emailValid && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    const { data, error: invokeErr } = await invokeEdgeFunction<{
      data?: { student: Student; credentials: { username: string; password: string } };
      error?: string;
    }>("create-student-with-user", {
      body: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        parent_id: parentId,
        pc_teacher_id: pcTeacherId || null,
      },
    });
    setSaving(false);

    const resultError = invokeErr ? await describeFunctionError(invokeErr) : data?.error;
    if (resultError) { setError(resultError); return; }

    const created = data?.data?.student;
    // The edge function inserted straight into the database, so the cached
    // students list knows nothing about it yet.
    invalidateCachePrefix("students:");

    navigate("/admin/students", {
      state: {
        notice: `Student created${created ? ` (${created.id})` : ""}. Their login details were emailed to ${email.trim()}.`,
      },
    });
  }

  return (
    <AdminLayout>
      <PageHeader title="Add student" />

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

          <div>
            <TextInput
              label="Student email (used to create the login)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@example.com"
              required
            />
            {email.trim().length > 0 && !emailValid && (
              <p className="text-xs text-red-500 mt-1">Enter a valid email address.</p>
            )}
          </div>

          <SelectInput
            label="Performance Coach"
            placeholder="Select the coach…"
            value={pcTeacherId}
            onChange={(e) => setPcTeacherId(e.target.value)}
            options={coaches.map((c) => ({
              value: String(c.id),
              label: `${c.first_name} ${c.last_name ?? ""}`.trim(),
            }))}
          />
          {coaches.length === 0 && (
            <p className="text-xs text-amber-600">
              No active Performance Coaches found — mark a teacher as a coach first.
            </p>
          )}

          <ParentPicker
            label="Parent"
            value={parentId}
            onChange={setParentId}
            returnTo="/admin/students/new"
          />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 mt-2">
            <Button type="submit" disabled={!canSubmit}>
              {saving ? "Creating…" : "Create student"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/admin/students")}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </AdminLayout>
  );
}

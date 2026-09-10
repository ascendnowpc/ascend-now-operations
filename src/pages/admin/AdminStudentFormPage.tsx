import { useEffect, useState, type FormEvent } from "react";
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
import { CURRICULUM_OPTIONS } from "../../components/portal/curriculumOptions";
import type { Student } from "../../types/database";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Add a student directly (/admin/students/new).
 *
 * The other way in is /admin/students/enroll, which raises an invoice, emails a
 * payment link, waits for a payment screenshot and only creates the student on
 * confirm. That flow stays — it is the right one when money is changing hands.
 * This is the direct path for when you just need the student in the system: a
 * form, a login, done, exactly like adding a teacher or an admin.
 *
 * No hours are bought here. For a family they are added on the parent
 * (/admin/parents/:id/packages) and shared by every sibling; a student who
 * isn't part of a family gets theirs through the enrollment flow as before.
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
  const [parentId, setParentId] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState("");
  const [school, setSchool] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Returning from "+ New parent" — that route sends the admin back with
  // ?parent=<id> so the family they just added is already selected.
  const preselectParentId = searchParams.get("parent");
  useEffect(() => {
    if (preselectParentId) setParentId(preselectParentId);
  }, [preselectParentId]);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = Boolean(firstName.trim()) && emailValid && !saving;

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
        curriculum: curriculum || null,
        school: school.trim() || null,
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

          <div className="grid grid-cols-2 gap-4">
            <SelectInput
              label="Curriculum"
              placeholder="Select…"
              value={curriculum}
              onChange={(e) => setCurriculum(e.target.value)}
              options={CURRICULUM_OPTIONS.map((c) => ({ value: c, label: c }))}
            />
            <TextInput label="School" value={school} onChange={(e) => setSchool(e.target.value)} />
          </div>

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

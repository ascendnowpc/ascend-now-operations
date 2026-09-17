import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ParentChildScreen } from "./ParentChildScreen";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";
import { useMyParent, useMyChildren } from "../../hooks/useParents";
import {
  StudentInfoFields,
  StudentInfoReadOnly,
  SectionLabel,
  studentInfoValueFromStudent,
  studentInfoValueToFields,
  missingStudentInfoFields,
  type StudentInfoValue,
} from "../../components/portal/StudentInfoFields";
import { studentNeedsProfileCompletion } from "../../utils/profileCompletion";
import type { Student } from "../../types/database";

/**
 * A child's own details, filled in by the parent.
 *
 * The same field set a student types into their mandatory first-login form
 * (`StudentInfoFields`) — phone, address/country, school, curriculum,
 * graduation year, birthday and the guardian's name/phone — but reached from
 * the parent's side, because a young child may never log in at all and the
 * parent is the only person who knows any of it. Whichever side fills a field
 * first, the other is never asked for it again: both write the same
 * `students` row, and `studentNeedsProfileCompletion` is the single rule that
 * decides whether anything is still outstanding.
 *
 * Editable only while something is missing, then locked read-only — exactly
 * how the student's own Profile tab behaves, so neither side can quietly
 * rewrite details the other settled. An admin can still change anything, from
 * the student detail page.
 *
 * Deliberately NOT here: the child's name, login email, username and password.
 * Those belong to the child's own account and are set once, at their first
 * login. The optional report card stays with the student and admin too — the
 * storage policy is scoped to the student's own account.
 */
function ChildDetailsView({ student }: { student: Student }) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parent } = useMyParent(session?.user?.id);
  const { updateChild } = useMyChildren(parent?.id);

  const [value, setValue] = useState<StudentInfoValue>(() => studentInfoValueFromStudent(student));
  const [notificationEmail, setNotificationEmail] = useState(student.notification_email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = !studentNeedsProfileCompletion(student);

  async function handleSave() {
    const missing = missingStudentInfoFields(value);
    if (missing.length > 0) { setError(`Please fill in: ${missing.join(", ")}.`); return; }
    if (!notificationEmail.trim()) { setError("Please fill in: Send updates to."); return; }

    setSaving(true);
    setError(null);
    const { error: saveError } = await updateChild(student.id, {
      ...studentInfoValueToFields(value),
      notification_email: notificationEmail.trim(),
    });
    setSaving(false);
    if (saveError) { setError(saveError); return; }

    navigate("/parent/children", {
      state: { notice: `Saved ${student.first_name}'s details.` },
    });
  }

  if (complete) {
    return (
      <Card className="p-8 max-w-3xl">
        <div className="mb-4">
          <SectionLabel>Send updates to</SectionLabel>
          <p className="text-sm text-navy-700 font-medium break-all">
            {student.notification_email ?? <span className="text-navy-300 italic">—</span>}
          </p>
        </div>
        <div className="border-t border-navy-50 pt-4">
          <StudentInfoReadOnly student={student} detailsLabel="Student details" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-8 max-w-3xl">
      <div className="mb-4">
        <SectionLabel>Send updates to</SectionLabel>
        <input
          type="email"
          value={notificationEmail}
          onChange={(e) => { setNotificationEmail(e.target.value); setError(null); }}
          placeholder="you@example.com"
          className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
      </div>

      <div className="border-t border-navy-50 pt-4">
        <StudentInfoFields value={value} onChange={setValue} required detailsLabel="Student details" />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-3">{error}</p>
      )}

      <div className="flex gap-3 mt-4">
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        <Button variant="ghost" onClick={() => navigate("/parent/children")}>Cancel</Button>
      </div>
    </Card>
  );
}

export default function ParentChildDetailsPage() {
  return (
    <ParentChildScreen
      title="Details"
      render={(student) => <ChildDetailsView student={student} />}
    />
  );
}

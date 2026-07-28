import { useEffect, useState, useRef, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput, PhoneInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { SubjectLevelSelect } from "../../components/ui/SubjectLevelSelect";
import { BeyondAcademicSubjectSelect, type BeyondAcademicOption } from "../../components/ui/BeyondAcademicSubjectSelect";
import { fetchTeacherById, useTeachers, useTeacherSubjects } from "../../hooks/useTeachers";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups, subjectDisplayLabel } from "../../hooks/useCurriculumGroups";
import { invokeEdgeFunction, describeFunctionError } from "../../lib/edgeFunctions";
import { COUNTRY_OPTIONS, COUNTRY_DIAL_CODES } from "../../data/countries";

type Category = "academic" | "beyond_academic" | "college_counselling";

export default function AdminTeacherFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { updateTeacher } = useTeachers();

  // Adding from the PC page (/admin/pcs → ?pc=1) pre-ticks the performance
  // coach box; adding from the Teachers page leaves it unticked. Still editable
  // either way — this only sets the default.
  const [searchParams] = useSearchParams();
  const createAsCoach = !isEditing && searchParams.get("pc") === "1";

  // Teacher fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("+1");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isCoach, setIsCoach] = useState(createAsCoach);
  // Edit mode: the linked login account + the email as loaded, so an email
  // change can be routed through the update-user-email edge function (which
  // keeps the Auth login credential + public.users.email in sync, not just
  // teachers.email).
  const [userId, setUserId] = useState<string | null>(null);
  const [originalEmail, setOriginalEmail] = useState("");

  // Login account fields (create mode only)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Track whether the user has manually overridden the auto-filled values
  const usernameManualRef = useRef(false);
  const passwordManualRef = useRef(false);

  // Subjects — create mode: structured list
  const [newSubjects, setNewSubjects] = useState<{ subjectId: number; curriculumId: number | null; label: string }[]>([]);
  const [createCategory, setCreateCategory] = useState<Category | "">("");
  const [createCurriculumId, setCreateCurriculumId] = useState("");
  const [createGroupId, setCreateGroupId] = useState("");
  const [createSubjectId, setCreateSubjectId] = useState("");

  // Subjects — edit mode: Academic/Non-Academic flow
  const [editCategory, setEditCategory] = useState<Category | "">("");
  const [editCurriculumId, setEditCurriculumId] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editSubjectId, setEditSubjectId] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teacherId = id ? Number(id) : undefined;
  const { subjects, addSubject, removeSubject } = useTeacherSubjects(teacherId);
  const { subjects: allSubjects } = useSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();

  // Beyond Academics subjects sit directly under it — one flat list, no
  // sections/categories at all. category_id is only ever non-null now for
  // subjects left behind under legacy, deactivated categories (Computer
  // Science, Music, …) — exclude those rather than resurfacing them.
  // College Counselling subjects are also excluded here even though they
  // aren't 'academic' either — they get their own flat picker below.
  const beyondAcademicSubjects = allSubjects.filter((s) => s.category !== "academic" && s.category !== "college_counselling" && s.category_id == null);

  // College Counselling subjects (College Counselling, College Essays) sit
  // directly under it — same flat, no-grouping picker as Beyond Academics.
  const collegeCounsellingSubjects = allSubjects.filter((s) => s.category === "college_counselling");

  const activeGroups = allGroups.filter((g) => g.is_active);
  const createCurriculumGroups = createCurriculumId
    ? activeGroups.filter((g) => String(g.curriculum_id) === createCurriculumId)
    : [];
  const editCurriculumGroups = editCurriculumId
    ? activeGroups.filter((g) => String(g.curriculum_id) === editCurriculumId)
    : [];
  const academicSubjectsForCreateGroup = createGroupId
    ? allSubjects.filter((s) => String(s.curriculum_group_id) === createGroupId && s.is_active)
    : [];
  const academicSubjectsForEditGroup = editGroupId
    ? allSubjects.filter((s) => String(s.curriculum_group_id) === editGroupId && s.is_active)
    : [];

  // For edit mode — filter out already-assigned pairs
  const assignedKeys = new Set(subjects.map((s) => `${s.subject_id}:${s.curriculum_id ?? ""}`));
  const filteredEditAcademic = academicSubjectsForEditGroup.filter(
    (s) => !assignedKeys.has(`${s.id}:${editCurriculumId}`)
  );
  const filteredEditBeyondAcademicOptions: BeyondAcademicOption[] = beyondAcademicSubjects
    .filter((s) => !assignedKeys.has(`${s.id}:`))
    .map((s) => ({ value: String(s.id), label: s.name }));
  const filteredEditCollegeCounsellingOptions: BeyondAcademicOption[] = collegeCounsellingSubjects
    .filter((s) => !assignedKeys.has(`${s.id}:`))
    .map((s) => ({ value: String(s.id), label: s.name }));

  // For create mode — filter out already-added pairs
  const addedKeys = new Set(newSubjects.map((s) => `${s.subjectId}:${s.curriculumId ?? ""}`));
  const filteredCreateAcademic = academicSubjectsForCreateGroup.filter(
    (s) => !addedKeys.has(`${s.id}:${createCurriculumId}`)
  );
  const filteredCreateBeyondAcademicOptions: BeyondAcademicOption[] = beyondAcademicSubjects
    .filter((s) => !addedKeys.has(`${s.id}:`))
    .map((s) => ({ value: String(s.id), label: s.name }));
  const filteredCreateCollegeCounsellingOptions: BeyondAcademicOption[] = collegeCounsellingSubjects
    .filter((s) => !addedKeys.has(`${s.id}:`))
    .map((s) => ({ value: String(s.id), label: s.name }));

  function getLabel(subjectId: number, curriculumId: number | null): string {
    const sub = allSubjects.find((s) => s.id === subjectId);
    const subLabel = sub ? subjectDisplayLabel(sub.name, sub.board, sub.subject_code, sub.level) : `#${subjectId}`;
    if (!curriculumId) return subLabel;
    const cur = curricula.find((c) => c.id === curriculumId)?.name;
    const group = sub?.curriculum_group_id ? allGroups.find((g) => g.id === sub.curriculum_group_id)?.name : null;
    const parts = [cur, group, subLabel].filter(Boolean);
    return parts.join(" | ");
  }

  useEffect(() => {
    if (!isEditing || !id) return;
    fetchTeacherById(Number(id)).then(({ data }) => {
      if (data) {
        setFirstName(data.first_name);
        setLastName(data.last_name ?? "");
        setCountry(data.country ?? "");
        setEmail(data.email ?? "");
        setUserId(data.user_id ?? null);
        setOriginalEmail(data.email ?? "");
        // Parse stored phone back into dial code + number if it starts with +
        const stored = data.phone_number ?? "";
        const match = stored.match(/^(\+\d{1,4})\s*(.*)$/);
        if (match) { setDialCode(match[1]); setPhoneNumber(match[2]); }
        else setPhoneNumber(stored);
        setIsCoach(data.is_performance_coach);
      }
      setLoading(false);
    });
  }, [id, isEditing]);

  // Auto-fill username from email (create mode only, unless manually overridden)
  useEffect(() => {
    if (isEditing || usernameManualRef.current) return;
    const derived = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
    setUsername(derived);
  }, [email, isEditing]);

  // Auto-fill password from first name (create mode only, unless manually overridden)
  useEffect(() => {
    if (isEditing || passwordManualRef.current) return;
    if (firstName.trim()) {
      setPassword(`${firstName.trim().toLowerCase()}@ascendnow`);
    }
  }, [firstName, isEditing]);

  function handleCreateCategoryChange(cat: Category) {
    setCreateCategory(cat);
    setCreateCurriculumId("");
    setCreateGroupId("");
    setCreateSubjectId("");
  }

  function handleEditCategoryChange(cat: Category) {
    setEditCategory(cat);
    setEditCurriculumId("");
    setEditGroupId("");
    setEditSubjectId("");
    setEditError(null);
  }

  function addSubjectToList() {
    if (!createSubjectId) return;
    const subId = Number(createSubjectId);
    const curId = createCategory === "academic" && createCurriculumId ? Number(createCurriculumId) : null;
    const label = getLabel(subId, curId);
    setNewSubjects((prev) => [...prev, { subjectId: subId, curriculumId: curId, label }]);
    setCreateSubjectId("");
  }

  async function handleEditAdd() {
    if (!editSubjectId) return;
    setEditSaving(true);
    setEditError(null);
    const { error } = await addSubject(
      Number(editSubjectId),
      editCategory === "academic" && editCurriculumId ? Number(editCurriculumId) : null
    );
    if (error) setEditError(error);
    else { setEditSubjectId(""); }
    setEditSaving(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fullPhone = phoneNumber.trim()
      ? `${dialCode} ${phoneNumber.trim()}`
      : "";

    if (isEditing) {
      const teacherId = Number(id);
      const trimmedEmail = email.trim() || null;
      const emailChanged = (trimmedEmail ?? "").toLowerCase() !== originalEmail.toLowerCase();
      let syncedViaAuth = false;

      // A teacher with a linked login account whose email changed goes through
      // the update-user-email edge function so the Auth login credential +
      // public.users.email move with teachers.email — otherwise updateTeacher
      // alone would change only teachers.email and leave their login on the
      // old address. Teachers with no login account (userId null) just have
      // teachers.email updated the normal way below.
      if (emailChanged && trimmedEmail && userId) {
        const { data: emailData, error: emailErr } = await invokeEdgeFunction("update-user-email", {
          body: { newEmail: trimmedEmail, targetUserId: userId },
        });
        const emailMessage = emailErr
          ? await describeFunctionError(emailErr)
          : (emailData as { error?: string } | null)?.error ?? null;
        if (emailMessage) { setSaving(false); setError(emailMessage); return; }
        syncedViaAuth = true; // the edge function already wrote teachers.email
      }

      const { error } = await updateTeacher(teacherId, {
        first_name: firstName,
        last_name: lastName || null,
        country: country || null,
        phone_number: fullPhone || null,
        is_performance_coach: isCoach,
        ...(syncedViaAuth ? {} : { email: trimmedEmail }),
      });
      setSaving(false);
      if (error) { setError(error); return; }
      navigate(isCoach ? `/admin/pcs/${teacherId}` : `/admin/teachers/${teacherId}`);
      return;
    }

    // Create mode
    const { data, error: invokeErr } = await invokeEdgeFunction<{ data: { id: number } }>(
      "create-teacher-with-user",
      {
        body: {
          username,
          email,
          password,
          first_name: firstName,
          last_name: lastName || null,
          country: country || null,
          phone_number: fullPhone || null,
          is_performance_coach: isCoach,
          subjects: newSubjects.map((s) => ({ subject_id: s.subjectId, curriculum_id: s.curriculumId })),
        },
      }
    );
    setSaving(false);

    const resultError = invokeErr ? await describeFunctionError(invokeErr) : (data as { error?: string } | null)?.error;
    if (resultError) {
      setError(resultError);
      return;
    }

    navigate(isCoach ? `/admin/pcs/${data!.data.id}` : `/admin/teachers/${data!.data.id}`);
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title={isEditing ? "Edit teacher" : createAsCoach ? "Add performance coach" : "Add teacher"}
        description={
          isEditing
            ? "Update this teacher's details. To manage subjects, use the Teacher Subjects tab."
            : createAsCoach
              ? "Add a new performance coach and create their login account in one step."
              : "Add a new teacher and create their login account in one step."
        }
      />

      <Card className="p-6 max-w-4xl">
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
              required={!isEditing}
            />
            <PhoneInput
              label="Phone number"
              dialCode={dialCode}
              onDialCodeChange={setDialCode}
              phoneNumber={phoneNumber}
              onPhoneNumberChange={setPhoneNumber}
            />
          </div>

          {/* Login account — only shown when creating a new teacher */}
          {!isEditing && (
            <>
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

              <hr className="border-navy-50 my-1" />
              <p className="text-sm font-semibold text-navy-700">Subjects taught</p>
              <div className="flex flex-wrap gap-2">
                {newSubjects.length === 0 && (
                  <p className="text-navy-300 text-sm">No subjects added yet.</p>
                )}
                {newSubjects.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-2 rounded-pill bg-navy-50 text-navy-600 px-3 py-1 text-sm"
                  >
                    {s.label}
                    <button
                      type="button"
                      onClick={() => setNewSubjects((prev) => prev.filter((_, j) => j !== i))}
                      className="text-navy-300 hover:text-red-500"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              {/* Category toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleCreateCategoryChange("academic")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    createCategory === "academic"
                      ? "bg-sky-500 text-white border-sky-500"
                      : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
                  }`}
                >
                  Academic
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateCategoryChange("beyond_academic")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    createCategory === "beyond_academic"
                      ? "bg-sky-500 text-white border-sky-500"
                      : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
                  }`}
                >
                  Beyond Academics
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateCategoryChange("college_counselling")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    createCategory === "college_counselling"
                      ? "bg-sky-500 text-white border-sky-500"
                      : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
                  }`}
                >
                  College Counselling
                </button>
              </div>

              {createCategory === "academic" && (
                <div className="flex flex-col gap-2 max-w-sm">
                  <SelectInput
                    label="Curriculum"
                    placeholder="Select curriculum…"
                    value={createCurriculumId}
                    onChange={(e) => { setCreateCurriculumId(e.target.value); setCreateGroupId(""); setCreateSubjectId(""); }}
                    options={curricula.map((c) => ({ value: String(c.id), label: c.name }))}
                  />
                  {createCurriculumId && (
                    <SelectInput
                      label="Subject group"
                      placeholder="Select subject group…"
                      value={createGroupId}
                      onChange={(e) => { setCreateGroupId(e.target.value); setCreateSubjectId(""); }}
                      options={createCurriculumGroups.map((g) => ({ value: String(g.id), label: g.name }))}
                    />
                  )}
                  {createGroupId && (
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <SubjectLevelSelect
                          subjects={filteredCreateAcademic}
                          value={createSubjectId}
                          onChange={setCreateSubjectId}
                        />
                      </div>
                      <Button type="button" size="sm" onClick={addSubjectToList} disabled={!createSubjectId} className="mb-0.5">
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {createCategory === "beyond_academic" && (
                <div className="flex flex-col gap-2 max-w-sm">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <BeyondAcademicSubjectSelect
                        options={filteredCreateBeyondAcademicOptions}
                        value={createSubjectId}
                        onChange={setCreateSubjectId}
                      />
                    </div>
                    <Button type="button" size="sm" onClick={addSubjectToList} disabled={!createSubjectId} className="mb-0.5">
                      Add
                    </Button>
                  </div>
                </div>
              )}

              {createCategory === "college_counselling" && (
                <div className="flex flex-col gap-2 max-w-sm">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <BeyondAcademicSubjectSelect
                        options={filteredCreateCollegeCounsellingOptions}
                        value={createSubjectId}
                        onChange={setCreateSubjectId}
                      />
                    </div>
                    <Button type="button" size="sm" onClick={addSubjectToList} disabled={!createSubjectId} className="mb-0.5">
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 mt-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEditing ? "Save changes" : createAsCoach ? "Create performance coach" : "Create teacher"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate(createAsCoach ? "/admin/pcs" : "/admin/teachers")}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>

      {/* Subjects — edit mode only */}
      {isEditing && (
        <Card className="p-6 max-w-4xl mt-6">
          <h3 className="font-semibold text-navy-700 mb-3">Subjects taught</h3>

          {/* Assigned subject pills */}
          <div className="flex flex-wrap gap-2 mb-4 min-h-[32px]">
            {subjects.length === 0 && <p className="text-navy-300 text-sm">No subjects added yet.</p>}
            {subjects.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-2 rounded-pill bg-navy-50 text-navy-600 px-3 py-1 text-sm"
              >
                {getLabel(s.subject_id, s.curriculum_id)}
                <button
                  onClick={() => removeSubject(s.id)}
                  className="text-navy-300 hover:text-red-500"
                  aria-label={`Remove ${getLabel(s.subject_id, s.curriculum_id)}`}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {/* Category toggle */}
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => handleEditCategoryChange("academic")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                editCategory === "academic"
                  ? "bg-sky-500 text-white border-sky-500"
                  : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
              }`}
            >
              Academic
            </button>
            <button
              type="button"
              onClick={() => handleEditCategoryChange("beyond_academic")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                editCategory === "beyond_academic"
                  ? "bg-sky-500 text-white border-sky-500"
                  : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
              }`}
            >
              Beyond Academics
            </button>
            <button
              type="button"
              onClick={() => handleEditCategoryChange("college_counselling")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                editCategory === "college_counselling"
                  ? "bg-sky-500 text-white border-sky-500"
                  : "bg-white text-navy-600 border-navy-100 hover:border-sky-300"
              }`}
            >
              College Counselling
            </button>
          </div>

          {editCategory === "academic" && (
            <div className="flex flex-col gap-2 max-w-sm">
              <SelectInput
                label="Curriculum"
                placeholder="Select curriculum…"
                value={editCurriculumId}
                onChange={(e) => { setEditCurriculumId(e.target.value); setEditGroupId(""); setEditSubjectId(""); }}
                options={curricula.map((c) => ({ value: String(c.id), label: c.name }))}
              />
              {editCurriculumId && (
                <SelectInput
                  label="Subject group"
                  placeholder="Select subject group…"
                  value={editGroupId}
                  onChange={(e) => { setEditGroupId(e.target.value); setEditSubjectId(""); setEditError(null); }}
                  options={editCurriculumGroups.map((g) => ({ value: String(g.id), label: g.name }))}
                />
              )}
              {editGroupId && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <SubjectLevelSelect
                      subjects={filteredEditAcademic}
                      value={editSubjectId}
                      onChange={(v) => { setEditSubjectId(v); setEditError(null); }}
                    />
                  </div>
                  <Button type="button" size="sm" onClick={handleEditAdd} disabled={editSaving || !editSubjectId} className="mb-0.5">
                    Add
                  </Button>
                </div>
              )}
            </div>
          )}

          {editCategory === "beyond_academic" && (
            <div className="flex flex-col gap-2 max-w-sm">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <BeyondAcademicSubjectSelect
                    options={filteredEditBeyondAcademicOptions}
                    value={editSubjectId}
                    onChange={(v) => { setEditSubjectId(v); setEditError(null); }}
                  />
                </div>
                <Button type="button" size="sm" onClick={handleEditAdd} disabled={editSaving || !editSubjectId} className="mb-0.5">
                  Add
                </Button>
              </div>
            </div>
          )}

          {editCategory === "college_counselling" && (
            <div className="flex flex-col gap-2 max-w-sm">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <BeyondAcademicSubjectSelect
                    options={filteredEditCollegeCounsellingOptions}
                    value={editSubjectId}
                    onChange={(v) => { setEditSubjectId(v); setEditError(null); }}
                  />
                </div>
                <Button type="button" size="sm" onClick={handleEditAdd} disabled={editSaving || !editSubjectId} className="mb-0.5">
                  Add
                </Button>
              </div>
            </div>
          )}

          {editError && <p className="text-xs text-red-600 mt-2">{editError}</p>}
        </Card>
      )}
    </AdminLayout>
  );
}

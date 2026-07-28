import { useRef, useState } from "react";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { PROFILE_ICONS, ProfileIcon } from "./profileIcons";
import type { PcAchievement, PcCardEntry, PcProfile } from "../../types/database";
import type { PcProfileDraft } from "../../hooks/usePcProfile";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

// A small labelled bordered section, matching the rest of the form.
function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold text-navy-700">{label}</p>
        {hint && <p className="text-xs text-navy-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// Editable ordered list of plain strings (bullets) — used for an
// achievement's "How we helped" checklist.
function StringListEditor({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="flex-1 rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 placeholder:text-navy-200 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300"
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-navy-300 hover:text-red-500 px-1.5 text-lg leading-none"
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="self-start text-sm font-medium text-sky-500 hover:text-sky-600"
      >
        + {addLabel}
      </button>
    </div>
  );
}

const EMPTY_ACHIEVEMENT: PcAchievement = {
  student_name: "",
  subject: "",
  institutions: "",
  institution_logo_urls: [],
  score_before: "",
  score_after: "",
  score_scale: "",
  helped: [],
};

function AchievementEditor({
  achievement,
  onChange,
  onRemove,
  uploadPhoto,
}: {
  achievement: PcAchievement;
  onChange: (next: PcAchievement) => void;
  onRemove: () => void;
  uploadPhoto: (file: File) => Promise<{ url: string | null; error: string | null }>;
}) {
  const logoRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Coerce the legacy single-logo field into the array so old rows edit cleanly.
  const logos = achievement.institution_logo_urls?.length
    ? achievement.institution_logo_urls
    : achievement.institution_logo_url
      ? [achievement.institution_logo_url]
      : [];

  function set<K extends keyof PcAchievement>(key: K, value: PcAchievement[K]) {
    onChange({ ...achievement, [key]: value });
  }

  function setLogos(next: string[]) {
    // Write the array and clear the deprecated single field so they can't diverge.
    onChange({ ...achievement, institution_logo_urls: next, institution_logo_url: null });
  }

  async function handleLogo(file: File | undefined) {
    if (!file) return;
    setUploadingLogo(true);
    setLogoError(null);
    const { url, error } = await uploadPhoto(file);
    setUploadingLogo(false);
    if (error) { setLogoError(error); return; }
    if (url) setLogos([...logos, url]);
  }

  return (
    <div className="rounded-xl border border-navy-100 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">Achievement</p>
        <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:text-red-600 font-medium">
          Remove
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput label="Student name" value={achievement.student_name} onChange={(e) => set("student_name", e.target.value)} placeholder="Ariel F" />
        <TextInput label="Subject / level" value={achievement.subject} onChange={(e) => set("subject", e.target.value)} placeholder="MYP 4 Math" />
      </div>
      <TextInput
        label="Institutions"
        value={achievement.institutions}
        onChange={(e) => set("institutions", e.target.value)}
        placeholder="World Academy · NYU"
      />
      <FieldGroup label="University pictures" hint="One or more logos, shown on the card in place of the institutions text.">
        <div className="flex items-center flex-wrap gap-3">
          {logos.map((src, k) => (
            <div key={k} className="relative">
              <img
                src={src}
                alt={achievement.institutions || "University"}
                className="w-12 h-12 rounded-lg object-contain bg-white ring-1 ring-navy-100"
              />
              <button
                type="button"
                onClick={() => setLogos(logos.filter((_, j) => j !== k))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white ring-1 ring-navy-100 text-navy-400 hover:text-red-500 flex items-center justify-center text-sm leading-none"
                aria-label="Remove picture"
              >
                ×
              </button>
            </div>
          ))}
          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { handleLogo(e.target.files?.[0]); if (logoRef.current) logoRef.current.value = ""; }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => logoRef.current?.click()} disabled={uploadingLogo}>
            {uploadingLogo ? <span className="inline-flex items-center gap-1.5"><Spinner size={14} /> Uploading…</span> : logos.length ? "Add picture" : "Upload picture"}
          </Button>
        </div>
        {logoError && <p className="text-xs text-red-600">{logoError}</p>}
      </FieldGroup>
      <div className="grid grid-cols-3 gap-3">
        <TextInput label="Score before" value={achievement.score_before} onChange={(e) => set("score_before", e.target.value)} placeholder="3" />
        <TextInput label="Score after" value={achievement.score_after} onChange={(e) => set("score_after", e.target.value)} placeholder="6" />
        <TextInput label="Out of" value={achievement.score_scale} onChange={(e) => set("score_scale", e.target.value)} placeholder="8" />
      </div>
      <FieldGroup label="How we helped">
        <StringListEditor
          items={achievement.helped}
          onChange={(next) => set("helped", next)}
          placeholder="Time management optimization."
          addLabel="Add point"
        />
      </FieldGroup>
    </div>
  );
}

const EMPTY_CARD_ENTRY: PcCardEntry = { icon: "cap", heading: "", text: "" };

// A single "icon + heading + short text" card — used for both Education
// entries and Performance Coach timeline stops.
function CardEntryEditor({
  title,
  entry,
  onChange,
  onRemove,
  headingPlaceholder,
  textPlaceholder,
}: {
  title: string;
  entry: PcCardEntry;
  onChange: (next: PcCardEntry) => void;
  onRemove: () => void;
  headingPlaceholder: string;
  textPlaceholder: string;
}) {
  function set<K extends keyof PcCardEntry>(key: K, value: PcCardEntry[K]) {
    onChange({ ...entry, [key]: value });
  }
  return (
    <div className="rounded-xl border border-navy-100 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">{title}</p>
        <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:text-red-600 font-medium">
          Remove
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PROFILE_ICONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => set("icon", key)}
            title={label}
            aria-label={label}
            className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors ${
              entry.icon === key
                ? "bg-sky-500 border-sky-500 text-white"
                : "bg-white border-navy-100 text-navy-400 hover:border-sky-300"
            }`}
          >
            <ProfileIcon icon={key} />
          </button>
        ))}
      </div>
      <TextInput label="Heading" value={entry.heading} onChange={(e) => set("heading", e.target.value)} placeholder={headingPlaceholder} />
      <TextInput label="Short text" value={entry.text} onChange={(e) => set("text", e.target.value)} placeholder={textPlaceholder} />
    </div>
  );
}

// The full profile editor form. Manages its own draft state seeded from the
// existing row, uploads a new photo on demand, and saves the whole draft
// (publishing it so assigned students can see it). Used on the coach's own
// /teacher/pc-profile page.
export function PcProfileEditor({
  profile,
  coachName,
  uploadPhoto,
  save,
  onCancel,
  onSaved,
}: {
  profile: PcProfile | null;
  coachName: string;
  uploadPhoto: (file: File) => Promise<{ url: string | null; error: string | null }>;
  save: (draft: PcProfileDraft, opts?: { publish?: boolean }) => Promise<{ error: string | null }>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [department, setDepartment] = useState(profile?.department ?? "");
  const [headline, setHeadline] = useState(profile?.headline ?? "Performance Coach");
  const [photoUrl, setPhotoUrl] = useState(profile?.photo_url ?? null);
  const [about, setAbout] = useState(profile?.about ?? "");
  const [achievements, setAchievements] = useState<PcAchievement[]>(profile?.achievements ?? []);
  const [responsibilities, setResponsibilities] = useState<PcCardEntry[]>(profile?.coach_responsibilities ?? []);
  const [education, setEducation] = useState<PcCardEntry[]>(profile?.education ?? []);
  const [contactEmail, setContactEmail] = useState(profile?.contact_email ?? "");
  const [contactPhone, setContactPhone] = useState(profile?.contact_phone ?? "");

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const name = coachName || "Performance Coach";

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    const { url, error } = await uploadPhoto(file);
    setUploading(false);
    if (error) { setError(error); return; }
    setPhotoUrl(url);
  }

  // Drop empty rows so the saved lists stay clean.
  function cleanList(items: string[]): string[] {
    return items.map((i) => i.trim()).filter(Boolean);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const cleanedAchievements = achievements
      .filter((a) => a.student_name.trim() || a.subject.trim() || a.score_after.trim())
      .map((a) => {
        const logos = a.institution_logo_urls?.length
          ? a.institution_logo_urls
          : a.institution_logo_url
            ? [a.institution_logo_url]
            : [];
        return {
          ...a,
          student_name: a.student_name.trim(),
          subject: a.subject.trim(),
          institutions: a.institutions.trim(),
          institution_logo_urls: logos.filter((u) => u && u.trim() !== ""),
          institution_logo_url: null,
          score_before: a.score_before.trim(),
          score_after: a.score_after.trim(),
          score_scale: a.score_scale.trim(),
          helped: cleanList(a.helped),
        };
      });
    function cleanEntries(items: PcCardEntry[]): PcCardEntry[] {
      return items
        .filter((e) => e.heading.trim() || e.text.trim())
        .map((e) => ({ icon: e.icon, heading: e.heading.trim(), text: e.text.trim() }));
    }
    const draft: PcProfileDraft = {
      department: department.trim() || null,
      headline: headline.trim() || "Performance Coach",
      photo_url: photoUrl,
      about: about.trim() || null,
      achievements: cleanedAchievements,
      // Educator Experience was removed from the profile — always cleared so a
      // previously-saved value can't linger on the card.
      educator_experience: [],
      coach_responsibilities: cleanEntries(responsibilities),
      education: cleanEntries(education),
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
    };
    const { error } = await save(draft, { publish: true });
    setSaving(false);
    if (error) { setError(error); return; }
    onSaved();
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      {/* Photo */}
      <FieldGroup label="Profile photo" hint="Shown to your assigned students.">
        <div className="flex items-center gap-4">
          {photoUrl ? (
            <img src={photoUrl} alt={name} className="w-20 h-20 rounded-full object-cover ring-2 ring-sky-100" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-sky-100 flex items-center justify-center">
              <span className="text-2xl font-bold text-sky-500">{initialsOf(name)}</span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handlePhoto(e.target.files?.[0])}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <span className="inline-flex items-center gap-1.5"><Spinner size={14} /> Uploading…</span> : photoUrl ? "Change photo" : "Upload photo"}
            </Button>
            {photoUrl && (
              <button type="button" onClick={() => setPhotoUrl(null)} className="text-sm text-navy-400 hover:text-red-500">
                Remove
              </button>
            )}
          </div>
        </div>
      </FieldGroup>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextInput label="Department badge" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Management" />
        <TextInput label="Title" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Performance Coach" />
      </div>

      <FieldGroup label="About you" hint="The intro students read first.">
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={5}
          placeholder="Hi there! I'm…"
          className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 placeholder:text-navy-200 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300"
        />
      </FieldGroup>

      <FieldGroup label="Performing achievements" hint="Students you've helped and their progress.">
        <div className="flex flex-col gap-3">
          {achievements.map((a, i) => (
            <AchievementEditor
              key={i}
              achievement={a}
              onChange={(next) => setAchievements(achievements.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setAchievements(achievements.filter((_, j) => j !== i))}
              uploadPhoto={uploadPhoto}
            />
          ))}
          <button
            type="button"
            onClick={() => setAchievements([...achievements, { ...EMPTY_ACHIEVEMENT }])}
            className="self-start text-sm font-medium text-sky-500 hover:text-sky-600"
          >
            + Add achievement
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="Performance coach — at Ascend Now" hint="Shown as a timeline on the card, one stop per entry.">
        <div className="flex flex-col gap-3">
          {responsibilities.map((r, i) => (
            <CardEntryEditor
              key={i}
              title="Responsibility"
              entry={r}
              onChange={(next) => setResponsibilities(responsibilities.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setResponsibilities(responsibilities.filter((_, j) => j !== i))}
              headingPlaceholder="Mentoring students"
              textPlaceholder="Through their academic journey."
            />
          ))}
          <button
            type="button"
            onClick={() => setResponsibilities([...responsibilities, { ...EMPTY_CARD_ENTRY }])}
            className="self-start text-sm font-medium text-sky-500 hover:text-sky-600"
          >
            + Add responsibility
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="Education" hint="Shown as its own section on the card, one box per entry.">
        <div className="flex flex-col gap-3">
          {education.map((e, i) => (
            <CardEntryEditor
              key={i}
              title="Education"
              entry={e}
              onChange={(next) => setEducation(education.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setEducation(education.filter((_, j) => j !== i))}
              headingPlaceholder="MA in Child & Adolescent Psychology"
              textPlaceholder="The American College in Greece"
            />
          ))}
          <button
            type="button"
            onClick={() => setEducation([...education, { ...EMPTY_CARD_ENTRY }])}
            className="self-start text-sm font-medium text-sky-500 hover:text-sky-600"
          >
            + Add education
          </button>
        </div>
      </FieldGroup>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextInput label="Contact email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="you@ascendnow.info" />
        <TextInput label="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+20 12 7742 2479" />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-3 pt-1">
        <Button onClick={handleSave} disabled={saving || uploading}>{saving ? "Saving…" : "Save profile"}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}

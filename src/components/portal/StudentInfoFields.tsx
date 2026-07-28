import { COUNTRY_CODES, splitPhone, joinPhone } from "../../data/countryCodes";
import { TextInput } from "../ui/Input";
import { CURRICULUM_OPTIONS } from "./curriculumOptions";
import type { Student } from "../../types/database";

const COUNTRIES = COUNTRY_CODES.map((c) => c.name);

// Shared "student info" field set — used in the student's own mandatory
// first-login form and their ongoing Profile tab. Covers everything admin
// never requires up front: phone/graduation year/birthday/school (original
// set) plus, as of 2026-07-07, curriculum, address/country, and the
// guardian's name/phone — the student fills in whatever wasn't already
// captured at enrollment.
export interface StudentInfoValue {
  phoneCode: string;
  phoneNum: string;
  graduationYear: string; // controlled as a string, parsed to a number on save
  birthday: string; // yyyy-mm-dd, matches <input type="date">
  school: string;
  curriculum: string;
  address: string;
  country: string;
  parentFullName: string;
  parentPhoneCode: string;
  parentPhoneNum: string;
}

type StudentInfoSource = Pick<
  Student,
  "phone_number" | "graduation_year" | "birthday" | "school" | "curriculum" | "address" | "country" | "parent_full_name" | "parent_phone_number"
>;

export function studentInfoValueFromStudent(student: StudentInfoSource): StudentInfoValue {
  const { code, number } = splitPhone(student.phone_number ?? null);
  const parentPhone = splitPhone(student.parent_phone_number ?? null);
  return {
    phoneCode: code || "+971",
    phoneNum: number,
    graduationYear: student.graduation_year != null ? String(student.graduation_year) : "",
    birthday: student.birthday ?? "",
    school: student.school ?? "",
    curriculum: student.curriculum ?? "",
    address: student.address ?? "",
    country: student.country ?? "UAE",
    parentFullName: student.parent_full_name ?? "",
    parentPhoneCode: parentPhone.code || "+971",
    parentPhoneNum: parentPhone.number,
  };
}

export function isStudentInfoValueComplete(v: StudentInfoValue): boolean {
  return missingStudentInfoFields(v).length === 0;
}

// Names of whichever required fields are still blank — so a submit attempt
// can tell the user exactly what's missing instead of just silently
// disabling the button. Only the report card (handled separately, as an
// upload) is genuinely optional — everything else here is required.
export function missingStudentInfoFields(v: StudentInfoValue): string[] {
  const missing: string[] = [];
  if (!v.country.trim()) missing.push("Country");
  if (!v.phoneNum.trim()) missing.push("Student phone number");
  if (!v.address.trim()) missing.push("Address");
  if (!v.curriculum.trim()) missing.push("Curriculum");
  if (!v.school.trim()) missing.push("School");
  if (!v.graduationYear.trim()) missing.push("Graduation year");
  if (!v.birthday.trim()) missing.push("Birthday");
  if (!v.parentFullName.trim()) missing.push("Parent/Guardian name");
  if (!v.parentPhoneNum.trim()) missing.push("Parent/Guardian phone");
  return missing;
}

// Every field, as it should be written once all of them are required (the
// student's own mandatory form / Profile tab).
export function studentInfoValueToFields(v: StudentInfoValue) {
  return {
    phone_number: joinPhone(v.phoneCode, v.phoneNum),
    graduation_year: v.graduationYear.trim() ? Number(v.graduationYear) : null,
    birthday: v.birthday || null,
    school: v.school.trim() || null,
    curriculum: v.curriculum || null,
    address: v.address.trim() || null,
    country: v.country || null,
    parent_full_name: v.parentFullName.trim() || null,
    parent_phone_number: joinPhone(v.parentPhoneCode, v.parentPhoneNum),
  };
}

const CURRENT_YEAR = new Date().getFullYear();
const GRADUATION_YEARS = Array.from({ length: 14 }, (_, i) => CURRENT_YEAR - 1 + i);

export function SectionLabel({ children }: { children: string }) {
  return <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">{children}</p>;
}

export function StudentInfoFields({
  value,
  onChange,
  required,
}: {
  value: StudentInfoValue;
  onChange: (next: StudentInfoValue) => void;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Country first, then phone — the two are independent (picking a
          country never touches the phone's dial code), since a student may
          live somewhere but carry a number from elsewhere. */}
      <div>
        <SectionLabel>Your details</SectionLabel>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">
              Country{required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <select
              value={value.country}
              onChange={(e) => onChange({ ...value, country: e.target.value })}
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              {COUNTRIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">
              Student phone number{required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <div className="flex gap-2">
              <select
                value={value.phoneCode}
                onChange={(e) => onChange({ ...value, phoneCode: e.target.value })}
                className="rounded-xl border border-navy-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 w-36"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} {c.name}</option>
                ))}
              </select>
              <input
                type="tel"
                value={value.phoneNum}
                onChange={(e) => onChange({ ...value, phoneNum: e.target.value })}
                placeholder="50 123 4567"
                className="flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
          </div>

          <TextInput
            label="Address"
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            placeholder="Street, city…"
            required={required}
          />
        </div>
      </div>

      <div className="border-t border-navy-50 pt-4">
        <SectionLabel>School</SectionLabel>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">
              Curriculum{required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <select
              value={value.curriculum}
              onChange={(e) => onChange({ ...value, curriculum: e.target.value })}
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="">Select…</option>
              {CURRICULUM_OPTIONS.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>

          <TextInput
            label="School"
            value={value.school}
            onChange={(e) => onChange({ ...value, school: e.target.value })}
            placeholder="School name"
            required={required}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1">
                Graduation year{required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <select
                value={value.graduationYear}
                onChange={(e) => onChange({ ...value, graduationYear: e.target.value })}
                className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <option value="">Select…</option>
                {GRADUATION_YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <TextInput
              label="Birthday"
              type="date"
              value={value.birthday}
              onChange={(e) => onChange({ ...value, birthday: e.target.value })}
              required={required}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-navy-50 pt-4">
        <SectionLabel>Parent / Guardian</SectionLabel>
        <div className="flex flex-col gap-3">
          <TextInput
            label="Parent/Guardian name"
            value={value.parentFullName}
            onChange={(e) => onChange({ ...value, parentFullName: e.target.value })}
            required={required}
          />
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">
              Parent/Guardian phone{required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <div className="flex gap-2">
              <select
                value={value.parentPhoneCode}
                onChange={(e) => onChange({ ...value, parentPhoneCode: e.target.value })}
                className="rounded-xl border border-navy-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 w-36"
              >
                {COUNTRY_CODES.map((c) => (<option key={c.code} value={c.code}>{c.code} {c.name}</option>))}
              </select>
              <input
                type="tel"
                value={value.parentPhoneNum}
                onChange={(e) => onChange({ ...value, parentPhoneNum: e.target.value })}
                placeholder="50 123 4567"
                className="flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-navy-400 w-36 shrink-0">{label}</dt>
      <dd className="text-navy-700 font-medium break-all">{value ?? <span className="text-navy-300 italic">—</span>}</dd>
    </div>
  );
}

// Read-only display for once these fields are complete — a student can't
// come back and edit them afterward from their own Profile tab (only admin
// can, from the student detail page); shown in place of the editable
// StudentInfoFields once isStudentInfoValueComplete() is true. Mirrors the
// same three grouped sections as the editable form above, so the page
// looks the same whether a field is still open for editing or locked.
export function StudentInfoReadOnly({ student }: { student: StudentInfoSource }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel>Your details</SectionLabel>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <InfoRow label="Country" value={student.country} />
          <InfoRow label="Student phone number" value={student.phone_number} />
          <InfoRow label="Address" value={student.address} />
        </dl>
      </div>

      <div className="border-t border-navy-50 pt-4">
        <SectionLabel>School</SectionLabel>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <InfoRow label="Curriculum" value={student.curriculum} />
          <InfoRow label="School" value={student.school} />
          <InfoRow label="Graduation year" value={student.graduation_year != null ? String(student.graduation_year) : null} />
          <InfoRow label="Birthday" value={student.birthday ? new Date(student.birthday).toLocaleDateString() : null} />
        </dl>
      </div>

      <div className="border-t border-navy-50 pt-4">
        <SectionLabel>Parent / Guardian</SectionLabel>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <InfoRow label="Name" value={student.parent_full_name} />
          <InfoRow label="Phone" value={student.parent_phone_number} />
        </dl>
      </div>
    </div>
  );
}

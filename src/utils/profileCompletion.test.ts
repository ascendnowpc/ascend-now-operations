import { describe, it, expect } from "vitest";
import {
  studentNeedsProfileCompletion,
  teacherNeedsProfileCompletion,
  adminNeedsProfileCompletion,
} from "./profileCompletion";

type StudentFields = Parameters<typeof studentNeedsProfileCompletion>[0];
type TeacherFields = Parameters<typeof teacherNeedsProfileCompletion>[0];
type AdminFields = Parameters<typeof adminNeedsProfileCompletion>[0];

const completeStudent: StudentFields = {
  phone_number: "+91 90000 00000",
  graduation_year: 2027,
  birthday: "2009-04-12",
  school: "Springfield High",
  curriculum: "IBDP",
  address: "12 Elm Street",
  country: "India",
  parent_full_name: "Ada Lovelace",
  parent_phone_number: "+91 90000 00001",
  notification_email: "parent@example.com",
};

const completeTeacher: TeacherFields = {
  last_name: "Turing",
  email: "alan@example.com",
  phone_number: "+44 7000 000000",
  country: "United Kingdom",
};

describe("studentNeedsProfileCompletion", () => {
  it("does not prompt a student whose profile is fully filled in", () => {
    expect(studentNeedsProfileCompletion(completeStudent)).toBe(false);
  });

  it.each(Object.keys(completeStudent) as (keyof StudentFields)[])(
    "prompts when %s is missing",
    (field) => {
      expect(studentNeedsProfileCompletion({ ...completeStudent, [field]: null })).toBe(true);
    }
  );

  it("treats an empty string as missing, not as an answer", () => {
    expect(studentNeedsProfileCompletion({ ...completeStudent, school: "" })).toBe(true);
  });

  it("accepts graduation_year 0 — only null counts as unanswered", () => {
    expect(studentNeedsProfileCompletion({ ...completeStudent, graduation_year: 0 })).toBe(false);
  });
});

describe("teacherNeedsProfileCompletion", () => {
  it("does not prompt a teacher whose profile is fully filled in", () => {
    expect(teacherNeedsProfileCompletion(completeTeacher)).toBe(false);
  });

  it.each(Object.keys(completeTeacher) as (keyof TeacherFields)[])(
    "prompts when %s is missing",
    (field) => {
      expect(teacherNeedsProfileCompletion({ ...completeTeacher, [field]: null })).toBe(true);
    }
  );

  it("treats an empty string as missing", () => {
    expect(teacherNeedsProfileCompletion({ ...completeTeacher, phone_number: "" })).toBe(true);
  });
});

const completeAdmin: AdminFields = {
  phone_number: "+1 555 0100",
  country: "United States",
};

describe("adminNeedsProfileCompletion", () => {
  it("does not prompt an admin whose phone and country are filled in", () => {
    expect(adminNeedsProfileCompletion(completeAdmin)).toBe(false);
  });

  it.each(Object.keys(completeAdmin) as (keyof AdminFields)[])(
    "prompts when %s is missing",
    (field) => {
      expect(adminNeedsProfileCompletion({ ...completeAdmin, [field]: null })).toBe(true);
    }
  );

  it("treats an empty string as missing", () => {
    expect(adminNeedsProfileCompletion({ ...completeAdmin, phone_number: "" })).toBe(true);
  });
});

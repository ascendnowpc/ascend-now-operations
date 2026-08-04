import { describe, it, expect } from "vitest";
import { coordinatorFieldState, derivedCoordinatorId } from "./sessionCoordinator";

describe("coordinatorFieldState", () => {
  it("derives the coach from the student, read-only, once one is selected", () => {
    expect(
      coordinatorFieldState({ studentInvolved: true, selectedStudentId: "STU-1", assignedPcId: "PC-1" })
    ).toEqual({ mode: "derived", teacherId: "PC-1", hint: null });
  });

  it("offers nobody until a student is chosen", () => {
    // The bug this closes: the field used to fall back to every coach here, so
    // a coordinator picked before the student stuck and the session was filed
    // against a coach unrelated to them.
    const field = coordinatorFieldState({
      studentInvolved: true,
      selectedStudentId: null,
      assignedPcId: null,
    });
    expect(field).toMatchObject({ mode: "derived", teacherId: null });
    expect(field.mode === "derived" && field.hint).toBeTruthy();
  });

  it("says so when the student has no coach, rather than offering every coach", () => {
    const field = coordinatorFieldState({
      studentInvolved: true,
      selectedStudentId: "STU-1",
      assignedPcId: null,
    });
    expect(field).toMatchObject({ mode: "derived", teacherId: null });
    expect(field.mode === "derived" && field.hint).toMatch(/no Performance Coach/i);
  });

  it("keeps a picker for the program types that have no student", () => {
    // Work for Ascend Now / Ascend Offline Work ("Assigned by") — there is no
    // assignment to derive anything from.
    expect(
      coordinatorFieldState({ studentInvolved: false, selectedStudentId: null, assignedPcId: null })
    ).toEqual({ mode: "picker" });
  });

  it("keeps the picker for a student-less type even if a student is somehow still selected", () => {
    expect(
      coordinatorFieldState({ studentInvolved: false, selectedStudentId: "STU-1", assignedPcId: "PC-1" })
    ).toEqual({ mode: "picker" });
  });

  it("offers every coach for a demo lesson whose student isn't in the database", () => {
    // A demo lesson can be logged against a typed-in name (a prospective
    // student). There is no record, so no assignment to derive from — the
    // coach must be picked instead of the form dead-ending on "Select a
    // student first."
    expect(
      coordinatorFieldState({
        studentInvolved: true,
        selectedStudentId: null,
        assignedPcId: null,
        studentRecordOptional: true,
      })
    ).toEqual({ mode: "picker" });
  });

  it("still derives for a demo lesson booked against a real student record", () => {
    expect(
      coordinatorFieldState({
        studentInvolved: true,
        selectedStudentId: "STU-1",
        assignedPcId: "PC-1",
        studentRecordOptional: true,
      })
    ).toEqual({ mode: "derived", teacherId: "PC-1", hint: null });
  });

  it("still flags a selected demo student who has no coach", () => {
    const field = coordinatorFieldState({
      studentInvolved: true,
      selectedStudentId: "STU-1",
      assignedPcId: null,
      studentRecordOptional: true,
    });
    expect(field).toMatchObject({ mode: "derived", teacherId: null });
  });
});

describe("derivedCoordinatorId", () => {
  it("is the student's assigned coach", () => {
    expect(
      derivedCoordinatorId({ studentInvolved: true, selectedStudentId: "STU-1", assignedPcId: "PC-1" })
    ).toBe("PC-1");
  });

  it("clears when the student has no coach, so a previous student's coach can't survive", () => {
    // Switching from a student with a coach to one without must not leave the
    // first student's coach behind on the form.
    expect(
      derivedCoordinatorId({ studentInvolved: true, selectedStudentId: "STU-1", assignedPcId: null })
    ).toBe("");
  });

  it("clears when no student is selected yet", () => {
    expect(
      derivedCoordinatorId({ studentInvolved: true, selectedStudentId: null, assignedPcId: null })
    ).toBe("");
  });

  it("leaves a picker's value alone for a program type with no student", () => {
    // null = "don't touch": the value is the form-filler's choice, not derived.
    expect(
      derivedCoordinatorId({ studentInvolved: false, selectedStudentId: null, assignedPcId: "PC-1" })
    ).toBeNull();
  });

  it("leaves the coach alone once a demo lesson falls back to a typed-in student", () => {
    // Otherwise the coach the user just picked would be wiped out from under
    // them by the derive-from-student effect.
    expect(
      derivedCoordinatorId({
        studentInvolved: true,
        selectedStudentId: null,
        assignedPcId: null,
        studentRecordOptional: true,
      })
    ).toBeNull();
  });

  it("follows the student — a new assignment yields the new coach", () => {
    const first = derivedCoordinatorId({ studentInvolved: true, selectedStudentId: "S", assignedPcId: "PC-1" });
    const second = derivedCoordinatorId({ studentInvolved: true, selectedStudentId: "S", assignedPcId: "PC-2" });
    expect(first).toBe("PC-1");
    expect(second).toBe("PC-2");
  });

  it("re-derives when a demo lesson switches from a typed name to a real student", () => {
    const typed = derivedCoordinatorId({
      studentInvolved: true, selectedStudentId: null, assignedPcId: null, studentRecordOptional: true,
    });
    const picked = derivedCoordinatorId({
      studentInvolved: true, selectedStudentId: "STU-1", assignedPcId: "PC-9", studentRecordOptional: true,
    });
    expect(typed).toBeNull();
    expect(picked).toBe("PC-9");
  });
});

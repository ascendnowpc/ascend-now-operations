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
});

describe("derivedCoordinatorId", () => {
  it("is the student's assigned coach", () => {
    expect(derivedCoordinatorId({ studentInvolved: true, assignedPcId: "PC-1" })).toBe("PC-1");
  });

  it("clears when the student has no coach, so a previous student's coach can't survive", () => {
    // Switching from a student with a coach to one without must not leave the
    // first student's coach behind on the form.
    expect(derivedCoordinatorId({ studentInvolved: true, assignedPcId: null })).toBe("");
  });

  it("clears for a program type with no student", () => {
    expect(derivedCoordinatorId({ studentInvolved: false, assignedPcId: "PC-1" })).toBe("");
  });

  it("follows the student — a new assignment yields the new coach", () => {
    const first = derivedCoordinatorId({ studentInvolved: true, assignedPcId: "PC-1" });
    const second = derivedCoordinatorId({ studentInvolved: true, assignedPcId: "PC-2" });
    expect(first).toBe("PC-1");
    expect(second).toBe("PC-2");
  });
});

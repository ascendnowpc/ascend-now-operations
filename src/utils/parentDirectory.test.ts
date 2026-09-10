import { describe, it, expect } from "vitest";
import {
  parentDisplayName,
  parentPickerLabel,
  childrenOf,
  parentMatchesSearch,
  findParentByEmail,
} from "./parentDirectory";
import type { Parent, Student } from "../types/database";

function parent(over: Partial<Parent> = {}): Parent {
  return {
    id: "SARK26-1",
    first_name: "Sarah",
    last_name: "Khan",
    email: "sarah@example.com",
    phone_number: "+971 50 123 4567",
    user_id: "uuid-1",
    is_active: true,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function student(over: Partial<Student> = {}): Student {
  return {
    id: "AYAK26-1",
    first_name: "Ayaan",
    last_name: "Khan",
    parent_full_name: null,
    parent_phone_number: null,
    parent_id: "SARK26-1",
    phone_number: null,
    email: null,
    notification_email: null,
    curriculum: null,
    report_card_url: null,
    address: null,
    country: null,
    user_id: null,
    graduation_year: null,
    birthday: null,
    school: null,
    status: "active",
    status_changed_at: null,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("parentDisplayName", () => {
  it("joins the two name parts", () => {
    expect(parentDisplayName({ first_name: "Sarah", last_name: "Khan" })).toBe("Sarah Khan");
  });

  it("doesn't leave a trailing space when a name part is blank", () => {
    expect(parentDisplayName({ first_name: "Sarah", last_name: "" })).toBe("Sarah");
  });
});

describe("parentPickerLabel", () => {
  it("includes the email so two families with the same surname are tellable apart", () => {
    expect(parentPickerLabel(parent())).toBe("Sarah Khan · sarah@example.com (SARK26-1)");
  });

  it("falls back to name and id when there is no email on file", () => {
    expect(parentPickerLabel(parent({ email: null }))).toBe("Sarah Khan (SARK26-1)");
  });
});

describe("childrenOf — who belongs to a household", () => {
  it("returns only the students linked to that parent", () => {
    const students = [
      student({ id: "AYAK26-1", parent_id: "SARK26-1" }),
      student({ id: "ZOYK26-2", parent_id: "SARK26-1" }),
      student({ id: "OMAR26-3", parent_id: "OMAR26-9" }),
      student({ id: "NOBO26-4", parent_id: null }),
    ];
    expect(childrenOf(students, "SARK26-1").map((s) => s.id)).toEqual(["AYAK26-1", "ZOYK26-2"]);
  });

  it("orders siblings by enrollment sequence, not alphabetically", () => {
    // The trailing number of the student id is the enrollment sequence, so a
    // later-enrolled sibling stays second even when their name sorts first.
    const students = [
      student({ id: "ZOYK26-7", first_name: "Zoya", parent_id: "SARK26-1" }),
      student({ id: "AYAK26-2", first_name: "Ayaan", parent_id: "SARK26-1" }),
    ];
    expect(childrenOf(students, "SARK26-1").map((s) => s.id)).toEqual(["AYAK26-2", "ZOYK26-7"]);
  });

  it("has no children for a parent id that is null or missing", () => {
    const students = [student()];
    expect(childrenOf(students, null)).toEqual([]);
    expect(childrenOf(students, undefined)).toEqual([]);
    expect(childrenOf(students, "NOBODY26-1")).toEqual([]);
  });
});

describe("parentMatchesSearch", () => {
  it("matches on the mnemonic id", () => {
    expect(parentMatchesSearch(parent(), "SARK26")).toBe(true);
  });

  it("matches either name part, and the full name that no single column holds", () => {
    expect(parentMatchesSearch(parent(), "sarah")).toBe(true);
    expect(parentMatchesSearch(parent(), "khan")).toBe(true);
    expect(parentMatchesSearch(parent(), "sarah khan")).toBe(true);
  });

  it("matches email and phone", () => {
    expect(parentMatchesSearch(parent(), "example.com")).toBe(true);
    expect(parentMatchesSearch(parent(), "50 123")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(parentMatchesSearch(parent(), "  SaRaH  ")).toBe(true);
  });

  it("matches everything on an empty query, so the list isn't hidden until you search", () => {
    expect(parentMatchesSearch(parent(), "")).toBe(true);
    expect(parentMatchesSearch(parent(), "   ")).toBe(true);
  });

  it("doesn't match something that isn't there", () => {
    expect(parentMatchesSearch(parent(), "zzz")).toBe(false);
  });

  it("handles a parent with no email or phone without throwing", () => {
    expect(parentMatchesSearch(parent({ email: null, phone_number: null }), "sarah")).toBe(true);
    expect(parentMatchesSearch(parent({ email: null, phone_number: null }), "example")).toBe(false);
  });
});

describe("findParentByEmail — the sibling duplicate guard", () => {
  it("finds the family already using that address, whatever the casing", () => {
    const parents = [parent()];
    expect(findParentByEmail(parents, "SARAH@Example.com")?.id).toBe("SARK26-1");
    expect(findParentByEmail(parents, "  sarah@example.com  ")?.id).toBe("SARK26-1");
  });

  it("returns null for an address nobody uses", () => {
    expect(findParentByEmail([parent()], "new@example.com")).toBeNull();
  });

  it("returns null for a blank query rather than matching a parent with no email", () => {
    expect(findParentByEmail([parent({ email: null })], "")).toBeNull();
    expect(findParentByEmail([parent({ email: null })], "   ")).toBeNull();
  });
});

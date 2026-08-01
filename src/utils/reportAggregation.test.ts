import { describe, it, expect } from "vitest";
import {
  resolveReportSection,
  aggregateReportSections,
  groupSectionsIntoBlocks,
  type PackageMeta,
  type ReportRawLine,
  type ReportSection,
} from "./reportAggregation";

// Course-type name lookup standing in for the real one; unknown ids fall back
// the same way the app's courseTypeNameById does.
const CT_NAMES: Record<number, string> = {
  1: "Academic",
  2: "College Counselling",
  3: "Foundation Program",
  4: "All-In-One",
};
const courseTypeName = (id: number | null) => (id != null ? CT_NAMES[id] ?? "Unknown" : "No course type");

function line(over: Partial<ReportRawLine> = {}): ReportRawLine {
  return {
    student_package_id: null,
    course_type_id: 1,
    subject_id: 10,
    subjectName: "Maths",
    subjectLevel: "HL",
    curriculumName: "IB",
    program_type_id: null,
    programTypeName: null,
    teacherName: "Alice",
    hours: 1,
    session_count: 1,
    isNoShow: false,
    ...over,
  };
}

const resolveWith = (packages: Map<number, PackageMeta>) => (spid: number | null, ctid: number | null) =>
  resolveReportSection(spid, ctid, packages, courseTypeName);

describe("resolveReportSection", () => {
  it("names a bundle pool after its pool label and tags it with the bundle", () => {
    const pkgs = new Map<number, PackageMeta>([[7, { course_type_id: 1, package_type_id: 3, pool_label: "Academic Pool" }]]);
    expect(resolveReportSection(7, null, pkgs, courseTypeName)).toEqual({
      key: "pkg:7",
      sectionName: "Academic Pool",
      bundleName: "Foundation Program",
      courseTypeName: "Academic",
    });
  });

  it("falls back to the course type name when a bundle pool has no pool label", () => {
    const pkgs = new Map<number, PackageMeta>([[7, { course_type_id: 1, package_type_id: 3, pool_label: null }]]);
    expect(resolveReportSection(7, null, pkgs, courseTypeName).sectionName).toBe("Academic");
  });

  it("leaves a standalone package untagged by any bundle", () => {
    const pkgs = new Map<number, PackageMeta>([[9, { course_type_id: 2, package_type_id: null, pool_label: "ignored" }]]);
    expect(resolveReportSection(9, null, pkgs, courseTypeName)).toEqual({
      key: "pkg:9",
      sectionName: "College Counselling",
      bundleName: null,
      courseTypeName: "College Counselling",
    });
  });

  it("prefers the package's course type over the line's own when both are present", () => {
    const pkgs = new Map<number, PackageMeta>([[9, { course_type_id: 2, package_type_id: null, pool_label: null }]]);
    expect(resolveReportSection(9, 1, pkgs, courseTypeName).courseTypeName).toBe("College Counselling");
  });

  it("falls back to the line's own course type for a legacy row with no package", () => {
    expect(resolveReportSection(null, 1, new Map(), courseTypeName)).toEqual({
      key: "ct:1",
      sectionName: "Academic",
      bundleName: null,
      courseTypeName: "Academic",
    });
  });

  it("falls back to the line's course type when the package id is unknown", () => {
    expect(resolveReportSection(404, 2, new Map(), courseTypeName).key).toBe("ct:2");
  });

  it("keys a line with neither package nor course type as ct:none", () => {
    expect(resolveReportSection(null, null, new Map(), courseTypeName).key).toBe("ct:none");
  });

  it("keys every line of one package into the same section", () => {
    const pkgs = new Map<number, PackageMeta>([[7, { course_type_id: 1, package_type_id: 3, pool_label: "Pool" }]]);
    const a = resolveReportSection(7, 1, pkgs, courseTypeName);
    const b = resolveReportSection(7, 2, pkgs, courseTypeName);
    expect(a.key).toBe(b.key);
  });
});

describe("aggregateReportSections", () => {
  const resolve = resolveWith(new Map());

  it("sums hours and sessions for repeated lines on one subject and teacher", () => {
    const secs = aggregateReportSections([line({ hours: 1.5 }), line({ hours: 2, session_count: 2 })], resolve);
    expect(secs).toHaveLength(1);
    expect(secs[0].hours).toBe(3.5);
    expect(secs[0].session_count).toBe(3);
    expect(secs[0].subjects).toHaveLength(1);
    expect(secs[0].subjects[0].teachers).toHaveLength(1);
    expect(secs[0].subjects[0].teachers[0]).toEqual({
      teacherName: "Alice",
      hours: 3.5,
      session_count: 3,
      noShowCount: 0,
    });
  });

  it("counts a no-show's hour toward hours but never toward session_count", () => {
    const secs = aggregateReportSections([line({ hours: 1, isNoShow: true })], resolve);
    expect(secs[0].hours).toBe(1);
    expect(secs[0].session_count).toBe(0);
    expect(secs[0].noShowCount).toBe(1);
    expect(secs[0].subjects[0].noShowCount).toBe(1);
    expect(secs[0].subjects[0].teachers[0].noShowCount).toBe(1);
    expect(secs[0].subjects[0].teachers[0].session_count).toBe(0);
  });

  it("tracks no-shows and completed sessions side by side on the same teacher", () => {
    const secs = aggregateReportSections(
      [line({ hours: 2, session_count: 2 }), line({ hours: 1, isNoShow: true })],
      resolve,
    );
    expect(secs[0].hours).toBe(3);
    expect(secs[0].session_count).toBe(2);
    expect(secs[0].noShowCount).toBe(1);
  });

  it("splits the same subject taught under different curricula into separate rows", () => {
    const secs = aggregateReportSections(
      [line({ curriculumName: "IB" }), line({ curriculumName: "A-Level" })],
      resolve,
    );
    expect(secs[0].subjects).toHaveLength(2);
    expect(secs[0].subjects.map((s) => s.curriculumName).sort()).toEqual(["A-Level", "IB"]);
  });

  it("labels and keys a subjectless line by its program type", () => {
    const secs = aggregateReportSections(
      [
        line({ subject_id: null, subjectName: null, subjectLevel: "HL", curriculumName: "IB", program_type_id: 5, programTypeName: "College Essays" }),
        line({ subject_id: null, subjectName: null, program_type_id: 6, programTypeName: "College Counselling" }),
      ],
      resolve,
    );
    expect(secs[0].subjects.map((s) => s.subjectName).sort()).toEqual(["College Counselling", "College Essays"]);
    // A subjectless row carries no subject level/curriculum, even if the raw line had them.
    const essays = secs[0].subjects.find((s) => s.subjectName === "College Essays")!;
    expect(essays.subjectLevel).toBeNull();
    expect(essays.curriculumName).toBeNull();
  });

  it("labels a line with neither subject nor program type as an em dash", () => {
    const secs = aggregateReportSections(
      [line({ subject_id: null, subjectName: null, program_type_id: null, programTypeName: null })],
      resolve,
    );
    expect(secs[0].subjects[0].subjectName).toBe("—");
  });

  it("merges one teacher's hours across several subjects into a single section-level row", () => {
    const secs = aggregateReportSections(
      [
        line({ subject_id: 10, subjectName: "Maths", hours: 2 }),
        line({ subject_id: 11, subjectName: "Physics", hours: 3 }),
      ],
      resolve,
    );
    expect(secs[0].subjects).toHaveLength(2);
    expect(secs[0].teachers).toHaveLength(1);
    expect(secs[0].teachers[0]).toEqual({ teacherName: "Alice", hours: 5, session_count: 2, noShowCount: 0 });
  });

  it("sorts teachers and subjects by hours descending", () => {
    const secs = aggregateReportSections(
      [
        line({ subject_id: 10, subjectName: "Maths", teacherName: "Alice", hours: 1 }),
        line({ subject_id: 11, subjectName: "Physics", teacherName: "Bob", hours: 8 }),
        line({ subject_id: 11, subjectName: "Physics", teacherName: "Cara", hours: 2 }),
      ],
      resolve,
    );
    expect(secs[0].subjects.map((s) => s.subjectName)).toEqual(["Physics", "Maths"]);
    expect(secs[0].teachers.map((t) => t.teacherName)).toEqual(["Bob", "Cara", "Alice"]);
    expect(secs[0].subjects[0].teachers.map((t) => t.teacherName)).toEqual(["Bob", "Cara"]);
  });

  it("returns no sections for no lines", () => {
    expect(aggregateReportSections([], resolve)).toEqual([]);
  });

  it("keeps pools of the same bundle adjacent, ordered by hours within the bundle", () => {
    const pkgs = new Map<number, PackageMeta>([
      [1, { course_type_id: 1, package_type_id: 3, pool_label: "Foundation Academic" }],
      [2, { course_type_id: 2, package_type_id: 3, pool_label: "Foundation Counselling" }],
      [3, { course_type_id: 1, package_type_id: null, pool_label: null }],
    ]);
    const secs = aggregateReportSections(
      [
        line({ student_package_id: 3, hours: 100 }),
        line({ student_package_id: 1, hours: 5 }),
        line({ student_package_id: 2, hours: 9 }),
      ],
      resolveWith(pkgs),
    );
    // "Academic" (standalone, 100h) sorts before the two "Foundation Program"
    // pools by bundle/section name, and the pools stay together, bigger first.
    expect(secs.map((s) => s.sectionName)).toEqual(["Academic", "Foundation Counselling", "Foundation Academic"]);
    expect(secs[1].bundleName).toBe("Foundation Program");
    expect(secs[2].bundleName).toBe("Foundation Program");
  });
});

describe("groupSectionsIntoBlocks", () => {
  function section(over: Partial<ReportSection>): ReportSection {
    return {
      key: "k",
      sectionName: "Academic",
      bundleName: null,
      courseTypeName: "Academic",
      hours: 0,
      session_count: 0,
      noShowCount: 0,
      subjects: [],
      teachers: [],
      ...over,
    };
  }

  it("combines every pool of one bundle into a single block totalling all pools", () => {
    const blocks = groupSectionsIntoBlocks([
      section({ key: "pkg:1", sectionName: "Pool A", bundleName: "Foundation Program", hours: 5, session_count: 4, noShowCount: 1 }),
      section({ key: "pkg:2", sectionName: "Pool B", bundleName: "Foundation Program", hours: 3, session_count: 3, noShowCount: 0 }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("Foundation Program");
    expect(blocks[0].bundleName).toBe("Foundation Program");
    expect(blocks[0].hours).toBe(8);
    expect(blocks[0].session_count).toBe(7);
    expect(blocks[0].noShowCount).toBe(1);
    expect(blocks[0].sections.map((s) => s.sectionName)).toEqual(["Pool A", "Pool B"]);
  });

  it("gives every standalone section its own block titled by the section", () => {
    const blocks = groupSectionsIntoBlocks([
      section({ key: "ct:1", sectionName: "Academic", hours: 4 }),
      section({ key: "ct:2", sectionName: "College Counselling", hours: 2 }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.title)).toEqual(["Academic", "College Counselling"]);
    expect(blocks.every((b) => b.bundleName === null)).toBe(true);
    expect(blocks.every((b) => b.sections.length === 1)).toBe(true);
  });

  it("keeps two standalone sections that share a name as separate blocks", () => {
    const blocks = groupSectionsIntoBlocks([
      section({ key: "pkg:1", sectionName: "Academic", hours: 1 }),
      section({ key: "pkg:2", sectionName: "Academic", hours: 2 }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("groups two different bundles into one block each", () => {
    const blocks = groupSectionsIntoBlocks([
      section({ key: "pkg:1", sectionName: "Pool A", bundleName: "Foundation Program", hours: 1 }),
      section({ key: "pkg:2", sectionName: "Pool B", bundleName: "All-In-One", hours: 2 }),
      section({ key: "pkg:3", sectionName: "Pool C", bundleName: "Foundation Program", hours: 4 }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.title)).toEqual(["Foundation Program", "All-In-One"]);
    expect(blocks[0].hours).toBe(5);
  });

  it("returns no blocks for no sections", () => {
    expect(groupSectionsIntoBlocks([])).toEqual([]);
  });
});

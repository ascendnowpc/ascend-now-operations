import { describe, it, expect } from "vitest";
import { COUNTRY_CODES, splitPhone, joinPhone } from "./countryCodes";

describe("COUNTRY_CODES", () => {
  it("defaults the picker to the UAE, the first option", () => {
    expect(COUNTRY_CODES[0].code).toBe("+971");
  });

  it("lists every dial code exactly once", () => {
    const codes = COUNTRY_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("prefixes every dial code with + and digits only", () => {
    for (const c of COUNTRY_CODES) expect(c.code).toMatch(/^\+\d+$/);
  });
});

describe("splitPhone", () => {
  it("splits a stored phone into its dial code and local number", () => {
    expect(splitPhone("+971 501234567")).toEqual({ code: "+971", number: "501234567" });
  });

  it("defaults a missing phone to the UAE code and an empty number", () => {
    expect(splitPhone(null)).toEqual({ code: "+971", number: "" });
    expect(splitPhone("")).toEqual({ code: "+971", number: "" });
  });

  it("shows a legacy number stored without a dial code raw in the number field", () => {
    expect(splitPhone("0501234567")).toEqual({ code: "+971", number: "0501234567" });
  });

  it("treats a phone with no space after the code as unprefixed", () => {
    expect(splitPhone("+971501234567")).toEqual({ code: "+971", number: "+971501234567" });
  });

  it("keeps spacing inside the local number", () => {
    expect(splitPhone("+44 20 7946 0958")).toEqual({ code: "+44", number: "20 7946 0958" });
  });

  it("keeps a dial code whose number half is empty", () => {
    expect(splitPhone("+91 ")).toEqual({ code: "+91", number: "" });
  });
});

describe("joinPhone", () => {
  it("joins a code and number with a single space", () => {
    expect(joinPhone("+971", "501234567")).toBe("+971 501234567");
  });

  it("stores nothing when the number is blank, so an empty field is not saved as a bare code", () => {
    expect(joinPhone("+971", "")).toBeNull();
    expect(joinPhone("+971", "   ")).toBeNull();
  });

  it("trims stray whitespace around the typed number", () => {
    expect(joinPhone("+91", "  9876543210  ")).toBe("+91 9876543210");
  });

  it("round-trips a stored phone back to the same string", () => {
    const stored = "+966 512345678";
    const { code, number } = splitPhone(stored);
    expect(joinPhone(code, number)).toBe(stored);
  });
});

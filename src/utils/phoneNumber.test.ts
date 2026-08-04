import { describe, it, expect } from "vitest";
import { splitPhoneNumber, joinPhoneNumber } from "./phoneNumber";

describe("splitPhoneNumber", () => {
  it("splits a stored number into its dial code and the rest", () => {
    expect(splitPhoneNumber("+91 90000 00000")).toEqual({ dialCode: "+91", number: "90000 00000" });
  });

  it("takes up to four digits as the dial code when no space separates them", () => {
    // Without the space there is nothing to tell "+1 5550100" from
    // "+1555 0100", so the longest valid dial code wins.
    expect(splitPhoneNumber("+15550100")).toEqual({ dialCode: "+1555", number: "0100" });
  });

  it("keeps a number stored without a dial code whole", () => {
    expect(splitPhoneNumber("9000000000")).toEqual({ dialCode: "+1", number: "9000000000" });
  });

  it("uses the given fallback dial code when there is none to read", () => {
    expect(splitPhoneNumber("9000000000", "+91").dialCode).toBe("+91");
  });

  it("treats null and empty as no number at all", () => {
    expect(splitPhoneNumber(null)).toEqual({ dialCode: "+1", number: "" });
    expect(splitPhoneNumber("")).toEqual({ dialCode: "+1", number: "" });
    expect(splitPhoneNumber(undefined)).toEqual({ dialCode: "+1", number: "" });
  });

  it("ignores surrounding whitespace", () => {
    expect(splitPhoneNumber("  +44 7700 900000  ")).toEqual({ dialCode: "+44", number: "7700 900000" });
  });
});

describe("joinPhoneNumber", () => {
  it("joins the selector and the field into the stored form", () => {
    expect(joinPhoneNumber("+91", "90000 00000")).toBe("+91 90000 00000");
  });

  it("returns null for a blank number so a dial code alone is never saved", () => {
    expect(joinPhoneNumber("+1", "")).toBeNull();
    expect(joinPhoneNumber("+1", "   ")).toBeNull();
  });

  it("trims both parts", () => {
    expect(joinPhoneNumber(" +1 ", "  555 0100 ")).toBe("+1 555 0100");
  });

  it("round-trips a stored number unchanged", () => {
    const { dialCode, number } = splitPhoneNumber("+61 400 000 000");
    expect(joinPhoneNumber(dialCode, number)).toBe("+61 400 000 000");
  });
});

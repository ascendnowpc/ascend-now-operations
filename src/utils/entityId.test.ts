import { describe, it, expect } from "vitest";
import { idSeqNumber } from "./entityId";

describe("idSeqNumber — mnemonic id → creation sequence", () => {
  it("reads the trailing sequence number, not the name prefix", () => {
    expect(idSeqNumber("BATO26-1")).toBe(1);
    expect(idSeqNumber("RANW26-3")).toBe(3);
    expect(idSeqNumber("ABCD26-127")).toBe(127);
  });

  it("orders by creation, so a later id sorts after an alphabetically earlier one", () => {
    const ids = ["ZULU26-2", "ALFA26-10", "MIKE26-1"];
    expect([...ids].sort((a, b) => idSeqNumber(a) - idSeqNumber(b))).toEqual([
      "MIKE26-1",
      "ZULU26-2",
      "ALFA26-10",
    ]);
  });

  it("only takes digits at the very end of the id", () => {
    // The 26 in the year part must never win over the real sequence number.
    expect(idSeqNumber("BATO26-9")).toBe(9);
  });

  it("returns 0 for an id with no trailing number", () => {
    expect(idSeqNumber("BATO26-")).toBe(0);
    expect(idSeqNumber("NOSEQ")).toBe(0);
    expect(idSeqNumber("")).toBe(0);
  });

  it("returns 0 rather than NaN for a zero sequence, so sorting stays stable", () => {
    expect(idSeqNumber("BATO26-0")).toBe(0);
  });
});

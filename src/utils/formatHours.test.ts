import { describe, it, expect } from "vitest";
import { formatHours } from "./formatHours";

describe("formatHours — quarter-hour display without float artifacts", () => {
  it("keeps quarter-hour precision exactly", () => {
    expect(formatHours(0.25)).toBe("0.25");
    expect(formatHours(0.5)).toBe("0.5");
    expect(formatHours(0.75)).toBe("0.75"); // must NOT become "0.8"
  });

  it("strips trailing zeros on whole numbers", () => {
    expect(formatHours(1)).toBe("1");
    expect(formatHours(10)).toBe("10"); // the "0" inside 10 must survive
    expect(formatHours(100)).toBe("100");
    expect(formatHours(0)).toBe("0");
  });

  it("handles accumulated floating-point sums", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754
    expect(formatHours(0.1 + 0.2)).toBe("0.3");
  });

  it("rounds to 2 decimals", () => {
    expect(formatHours(1.333)).toBe("1.33");
    expect(formatHours(1.567)).toBe("1.57");
    expect(formatHours(2.999)).toBe("3");
  });
});

import { describe, it, expect } from "vitest";
import { ENGAGEMENT_SCORE, engagementLabel } from "./engagementScore";

describe("ENGAGEMENT_SCORE — low/medium/high → 1/2/3", () => {
  it("maps each engagement level to its numeric score", () => {
    expect(ENGAGEMENT_SCORE.low).toBe(1);
    expect(ENGAGEMENT_SCORE.medium).toBe(2);
    expect(ENGAGEMENT_SCORE.high).toBe(3);
  });
});

describe("engagementLabel — averaged score → display label", () => {
  it("shows an em dash when there's no score at all", () => {
    expect(engagementLabel(null)).toBe("—");
  });

  it("labels the three exact levels the way they were logged", () => {
    expect(engagementLabel(1)).toBe("1 · Low");
    expect(engagementLabel(2)).toBe("2 · Medium");
    expect(engagementLabel(3)).toBe("3 · High");
  });

  it("splits the bands at 1.67 and 2.34", () => {
    expect(engagementLabel(1.66)).toBe("1.66 · Low");
    expect(engagementLabel(1.67)).toBe("1.67 · Medium");
    expect(engagementLabel(2.33)).toBe("2.33 · Medium");
    expect(engagementLabel(2.34)).toBe("2.34 · High");
  });

  it("keeps the numeric average in the label alongside the band", () => {
    expect(engagementLabel(2.5)).toBe("2.5 · High");
  });

  it("treats a zero average as Low rather than as 'no score'", () => {
    expect(engagementLabel(0)).toBe("0 · Low");
  });
});

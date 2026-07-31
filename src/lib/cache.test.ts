import { describe, it, expect, afterEach, vi } from "vitest";
import { getCached, setCached, invalidateCache, invalidateCachePrefix } from "./cache";

// The store is module-level and shared, so every test uses its own key prefix.
let seq = 0;
const key = (name: string) => `test-${seq++}-${name}`;

afterEach(() => {
  vi.useRealTimers();
});

describe("getCached / setCached", () => {
  it("returns what was stored", () => {
    const k = key("students");
    setCached(k, [{ id: "BATO26-1" }]);
    expect(getCached(k)).toEqual([{ id: "BATO26-1" }]);
  });

  it("returns undefined for a key that was never set", () => {
    expect(getCached(key("never-set"))).toBeUndefined();
  });

  it("caches falsy values, so an empty list isn't refetched every render", () => {
    const empty = key("empty");
    setCached(empty, []);
    expect(getCached(empty)).toEqual([]);

    const zero = key("zero");
    setCached(zero, 0);
    expect(getCached(zero)).toBe(0);

    const nul = key("null");
    setCached(nul, null);
    expect(getCached(nul)).toBeNull();
  });

  it("overwrites an existing entry", () => {
    const k = key("overwrite");
    setCached(k, "first");
    setCached(k, "second");
    expect(getCached(k)).toBe("second");
  });
});

describe("TTL", () => {
  it("serves an entry inside the 1-minute window", () => {
    vi.useFakeTimers();
    const k = key("fresh");
    setCached(k, "value");
    vi.advanceTimersByTime(59_000);
    expect(getCached(k)).toBe("value");
  });

  it("expires an entry once the window has passed", () => {
    vi.useFakeTimers();
    const k = key("stale");
    setCached(k, "value");
    vi.advanceTimersByTime(60_001);
    expect(getCached(k)).toBeUndefined();
  });

  it("restarts the window on a re-set", () => {
    vi.useFakeTimers();
    const k = key("refreshed");
    setCached(k, "old");
    vi.advanceTimersByTime(50_000);
    setCached(k, "new");
    vi.advanceTimersByTime(50_000);
    expect(getCached(k)).toBe("new");
  });
});

describe("invalidateCache", () => {
  it("drops the named keys and leaves the rest", () => {
    const a = key("a");
    const b = key("b");
    const c = key("c");
    setCached(a, 1);
    setCached(b, 2);
    setCached(c, 3);

    invalidateCache(a, b);

    expect(getCached(a)).toBeUndefined();
    expect(getCached(b)).toBeUndefined();
    expect(getCached(c)).toBe(3);
  });

  it("is a no-op for keys that aren't cached", () => {
    expect(() => invalidateCache(key("absent"))).not.toThrow();
  });
});

describe("invalidateCachePrefix", () => {
  it("drops every key under the prefix", () => {
    const prefix = `sessions-${seq++}`;
    setCached(`${prefix}:2026-01`, 1);
    setCached(`${prefix}:2026-02`, 2);
    const other = key("students");
    setCached(other, 3);

    invalidateCachePrefix(prefix);

    expect(getCached(`${prefix}:2026-01`)).toBeUndefined();
    expect(getCached(`${prefix}:2026-02`)).toBeUndefined();
    expect(getCached(other)).toBe(3);
  });

  it("matches on the prefix only, not anywhere in the key", () => {
    const k = `${key("x")}-sessions`;
    setCached(k, 1);
    invalidateCachePrefix("sessions");
    expect(getCached(k)).toBe(1);
  });
});

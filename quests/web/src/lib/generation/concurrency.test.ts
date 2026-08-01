import { describe, expect, it } from "vitest";

import { POOL_MAX } from "@/lib/db";

import {
  afterRateLimit,
  budgetFor,
  clampToPool,
  COOL_DOWN_MS,
  familyOf,
  POOL_RESERVE,
  tierLimit,
} from "./concurrency";

describe("familyOf", () => {
  it("puts flash models in the flash family", () => {
    expect(familyOf("eleven_flash_v2_5")).toBe("flash");
  });

  // The docs name only flash in the higher column. Guessing high costs a wave of 429s;
  // guessing low costs nothing but time, so turbo sits with the standard models.
  it("keeps turbo and multilingual in the standard family", () => {
    expect(familyOf("eleven_turbo_v2_5")).toBe("standard");
    expect(familyOf("eleven_multilingual_v2")).toBe("standard");
    expect(familyOf("eleven_v3")).toBe("standard");
  });
});

describe("tierLimit", () => {
  it("matches the published table", () => {
    expect(tierLimit("free", "standard")).toBe(2);
    expect(tierLimit("starter", "standard")).toBe(3);
    expect(tierLimit("creator", "standard")).toBe(5);
    expect(tierLimit("pro", "standard")).toBe(10);
    expect(tierLimit("scale", "standard")).toBe(15);
    expect(tierLimit("business", "standard")).toBe(15);

    expect(tierLimit("free", "flash")).toBe(4);
    expect(tierLimit("starter", "flash")).toBe(6);
    expect(tierLimit("creator", "flash")).toBe(10);
    expect(tierLimit("pro", "flash")).toBe(20);
    expect(tierLimit("scale", "flash")).toBe(30);
    expect(tierLimit("business", "flash")).toBe(30);
  });

  it("reads the tier case-insensitively, since it is upstream text", () => {
    expect(tierLimit("Creator", "standard")).toBe(5);
  });

  it("treats enterprise as business, because 'elevated' is not a number", () => {
    expect(tierLimit("enterprise", "flash")).toBe(30);
  });

  it("falls back to the smallest limit for an unknown or absent tier", () => {
    expect(tierLimit("something_new", "flash")).toBe(2);
    expect(tierLimit(null, "flash")).toBe(2);
  });
});

describe("budgetFor", () => {
  // One slot stays free so the single-line Regenerate button and the pronunciation previews
  // on /lexicon are not starved by a running batch.
  it("reserves a slot for interactive work", () => {
    expect(budgetFor("pro", "eleven_multilingual_v2")).toBe(9);
    expect(budgetFor("scale", "eleven_flash_v2_5")).toBe(29);
  });

  it("never drops below one, so a batch always makes progress", () => {
    expect(budgetFor("free", "eleven_multilingual_v2")).toBe(1);
    expect(budgetFor(null, "eleven_multilingual_v2")).toBe(1);
  });
});

describe("clampToPool", () => {
  it("reduces a large tier's budget to what the pool can serve", () => {
    // scale on a flash model is 29, which would want 58 connections. Two per job in flight,
    // less the reserve, is the most the pool can hand out without deadlocking on itself.
    expect(clampToPool(29, 30)).toBe(11);
    expect(clampToPool(29, 30)).toBeLessThan(budgetFor("scale", "eleven_flash_v2_5"));
  });

  it("leaves a budget the pool can already serve alone", () => {
    expect(clampToPool(3, 30)).toBe(3);
  });

  it("never drops below one, however small the pool", () => {
    expect(clampToPool(9, POOL_RESERVE)).toBe(1);
  });

  it("keeps the configured pool able to serve the budget it allows", () => {
    // The pairing that matters in production: whatever POOL_MAX and POOL_RESERVE are, the
    // clamped budget must still fit in the pool alongside the reserve.
    const largest = clampToPool(Number.MAX_SAFE_INTEGER, POOL_MAX);
    expect(largest * 2 + POOL_RESERVE).toBeLessThanOrEqual(POOL_MAX);
  });
});

describe("afterRateLimit", () => {
  it("leaves the budget alone when nothing has been rate limited", () => {
    expect(afterRateLimit(10, null, 1_000)).toBe(10);
  });

  it("halves the budget for the cool-down after a 429", () => {
    expect(afterRateLimit(10, 1_000, 1_000)).toBe(5);
    expect(afterRateLimit(9, 1_000, 1_000)).toBe(4);
  });

  it("never halves below one", () => {
    expect(afterRateLimit(1, 1_000, 1_000)).toBe(1);
  });

  it("returns to the derived budget once the cool-down expires", () => {
    expect(afterRateLimit(10, 1_000, 1_000 + COOL_DOWN_MS + 1)).toBe(10);
  });
});

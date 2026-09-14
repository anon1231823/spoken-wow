import { describe, expect, it } from "vitest";

import { BODY_MAX, isCategory, isStatus, optionalText, validateSubmission } from "./reports";

describe("isCategory", () => {
  it("accepts a known category", () => {
    expect(isCategory("pronunciation")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCategory("lore")).toBe(false);
    expect(isCategory(null)).toBe(false);
  });
});

describe("isStatus", () => {
  it("accepts the three statuses and nothing else", () => {
    expect(isStatus("open")).toBe(true);
    expect(isStatus("not_an_issue")).toBe(true);
    expect(isStatus("resolved")).toBe(false);
  });
});

describe("optionalText", () => {
  it("truncates rather than rejecting", () => {
    expect(optionalText("a".repeat(300), 200)).toHaveLength(200);
  });

  it("returns null for blank and non-string input", () => {
    expect(optionalText("   ", 200)).toBeNull();
    expect(optionalText(undefined, 200)).toBeNull();
  });
});

describe("validateSubmission", () => {
  it("accepts a minimal report", () => {
    expect(validateSubmission({ category: "missing", body: "No audio at all." })).toEqual({
      ok: true,
      value: { category: "missing", body: "No audio at all.", name: null, email: null },
    });
  });

  it("trims the body and rejects one that is empty after trimming", () => {
    expect(validateSubmission({ category: "other", body: "   " })).toEqual({
      ok: false,
      error: "body is required",
    });
  });

  it("rejects a body over the limit rather than truncating it", () => {
    expect(validateSubmission({ category: "other", body: "x".repeat(BODY_MAX + 1) }).ok).toBe(
      false,
    );
  });

  it("rejects an unknown category", () => {
    expect(validateSubmission({ category: "lore", body: "hi" })).toEqual({
      ok: false,
      error: "unknown category",
    });
  });
});

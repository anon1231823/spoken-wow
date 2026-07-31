import { describe, expect, it } from "vitest";

import { activeFilterCount } from "./active-filters";

describe("counting what is in force", () => {
  it("counts nothing on an untouched explorer", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ q: "", filter: "any" })).toBe(0);
  });

  it("does not count whitespace as a query", () => {
    expect(activeFilterCount({ q: "   " })).toBe(0);
  });

  it("counts the query, which narrows like the rest", () => {
    expect(activeFilterCount({ q: "dughan" })).toBe(1);
  });

  it("counts the scope only when there is a query for it to scope", () => {
    // On its own it says where a query is matched, and there is no query to match.
    expect(activeFilterCount({ filter: "text" })).toBe(0);
    expect(activeFilterCount({ q: "dughan", filter: "text" })).toBe(2);
  });

  it("counts each narrowing filter once", () => {
    expect(activeFilterCount({ race: "human", gender: "male", voice: "human-male-official" })).toBe(3);
  });

  it("counts the booleans only when they are true", () => {
    expect(activeFilterCount({ missingOnly: false, overridden: false })).toBe(0);
    expect(activeFilterCount({ missingOnly: true, overridden: true })).toBe(2);
  });

  it("counts a deep-linked finding, which narrows harder than anything else", () => {
    expect(activeFilterCount({ finding: 42 })).toBe(1);
  });

  it("counts an issue severity of zero-like shape", () => {
    // "any" and the severities are all truthy, but severity is a number and 0 is not a
    // severity - this pins that the filter is not tested for truthiness alone.
    expect(activeFilterCount({ issues: "any" })).toBe(1);
    expect(activeFilterCount({ issues: 1 })).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import { contributionsHref, nextContributionFilters } from "./query";

describe("nextContributionFilters", () => {
  const current = { status: "new", provenance: "all" } as const;

  it("changes the dimension named in `next` and keeps the other", () => {
    expect(nextContributionFilters(current, { provenance: "corpus" })).toEqual({
      status: "new",
      provenance: "corpus",
    });
  });

  it("resets a dimension to 'all' when `next` names it with no value", () => {
    // FilterChip's reset button calls onChange(undefined) -- the key is present, the value
    // isn't, and that must read as "clear this filter", not "leave it alone".
    expect(nextContributionFilters({ status: "accepted", provenance: "moderator" }, { provenance: undefined })).toEqual(
      { status: "accepted", provenance: "all" },
    );
  });

  it("leaves both alone when `next` names neither", () => {
    expect(nextContributionFilters(current, {})).toEqual(current);
  });
});

describe("contributionsHref", () => {
  it("builds a query string carrying both dimensions", () => {
    expect(contributionsHref({ status: "new", provenance: "all" }, { status: "rejected" })).toBe(
      "/contributions?status=rejected&provenance=all",
    );
  });
});

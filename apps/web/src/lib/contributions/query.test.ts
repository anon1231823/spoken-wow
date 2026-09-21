import { describe, expect, it } from "vitest";

import { NEEDS_DECISION, contributionsHref, matchesSpeaker, nextContributionFilters } from "./query";

describe("nextContributionFilters", () => {
  const current = { status: "new", provenance: "all", client: "all" } as const;

  it("changes the dimension named in `next` and keeps the other", () => {
    expect(nextContributionFilters(current, { provenance: "corpus" })).toEqual({
      status: "new",
      provenance: "corpus",
      client: "all",
    });
  });

  it("resets a dimension to 'all' when `next` names it with no value", () => {
    // FilterChip's reset button calls onChange(undefined) -- the key is present, the value
    // isn't, and that must read as "clear this filter", not "leave it alone".
    expect(nextContributionFilters({ status: "accepted", provenance: "moderator", client: "forever" }, { provenance: undefined })).toEqual(
      { status: "accepted", provenance: "all", client: "forever" },
    );
  });

  it("changes the client dimension alone", () => {
    expect(nextContributionFilters(current, { client: "private" })).toEqual({ ...current, client: "private" });
  });

  it("leaves every dimension alone when `next` names none", () => {
    expect(nextContributionFilters(current, {})).toEqual(current);
  });
});

describe("contributionsHref", () => {
  it("builds a query string carrying every dimension", () => {
    expect(contributionsHref({ status: "new", provenance: "all", client: "era" }, { status: "rejected" })).toBe(
      "/contributions?status=rejected&provenance=all&client=era",
    );
  });

  // The sentinel round-trips through the URL like any other provenance value -- no special
  // encoding, just the same string page.tsx's own parsing compares rawProvenance against.
  it("round-trips the NEEDS_DECISION sentinel through the href", () => {
    expect(
      contributionsHref({ status: "all", provenance: "all", client: "all" }, { provenance: NEEDS_DECISION }),
    ).toBe(`/contributions?status=all&provenance=${NEEDS_DECISION}&client=all`);
  });
});

describe("matchesSpeaker", () => {
  it("matches only 'client' and 'none' for the NEEDS_DECISION sentinel, and nothing else", () => {
    // Bite-check: if the special case in matchesSpeaker were ever deleted or short-circuited to
    // `provenance === filter` like the plain-provenance branch, "corpus" and "moderator" would
    // start passing here too -- this pins that they must not.
    expect(matchesSpeaker("client", NEEDS_DECISION)).toBe(true);
    expect(matchesSpeaker("none", NEEDS_DECISION)).toBe(true);
    expect(matchesSpeaker("corpus", NEEDS_DECISION)).toBe(false);
    expect(matchesSpeaker("moderator", NEEDS_DECISION)).toBe(false);
  });

  it("still matches a single provenance exactly when the filter names one", () => {
    expect(matchesSpeaker("corpus", "corpus")).toBe(true);
    expect(matchesSpeaker("client", "corpus")).toBe(false);
  });

  it("matches everything when the filter is 'all', including a row with no npc", () => {
    expect(matchesSpeaker(undefined, "all")).toBe(true);
  });

  it("never matches a row with no npc for a real filter, sentinel included", () => {
    expect(matchesSpeaker(undefined, NEEDS_DECISION)).toBe(false);
    expect(matchesSpeaker(undefined, "client")).toBe(false);
  });
});

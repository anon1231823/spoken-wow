/**
 * The query string /contributions's two filter dropdowns write to, and the Speaker dropdown's
 * one sentinel value.
 *
 * A free function, not inlined in ContributionTable's click handler, so the mapping -- combine
 * whichever dimension just changed with the other as it stands, the same rule ReportTable's own
 * `go` follows -- can be pinned by a test without rendering FilterChip or a page. Node-free, like
 * contributions.ts and npc.ts, whose types this one only composes: ContributionTable is a client
 * component and calls this directly on every dropdown change.
 */
import type { ContributionStatus } from "./contributions";
import type { Provenance } from "../npc/npc";

/**
 * "Everything a moderator still owes a decision" -- not a fifth provenance, a sentinel over the
 * four real ones. `client` (a guess nobody has looked at) and `none` (nothing known at all) are
 * exactly the two provenances `confirmed` can never be true for, which is the whole reason this
 * queue exists: the brief's own words for it are "tweak unconfirmed NPCs later".
 *
 * A single-select Speaker dropdown of the four provenances alone cannot express that union --
 * picking "Client guess" or "No race" narrows to one of the two, never both in one click -- so
 * dropping the old Confirmed/Unconfirmed axis entirely (both of which were themselves unions of
 * two provenances, not renamed single ones) would have quietly removed a real view rather than
 * a duplicate one. This sentinel restores the "unconfirmed" half of that view without bringing
 * back a second dropdown or the "confirmed" half: nobody triages the settled rows, so there is
 * no queue that ever wants "corpus or moderator" as one filter.
 *
 * Kept off `isProvenance`'s own union on purpose: a value it doesn't recognise must fall back to
 * "all" (page.tsx's own parsing already does this for any unrecognised string), not silently
 * mean "needs a decision" -- the two are handled by two separate checks in matchesSpeaker so a
 * typo in the query string can never masquerade as this filter.
 */
export const NEEDS_DECISION = "needs-decision" as const;

export type SpeakerFilter = Provenance | "all" | typeof NEEDS_DECISION;

export type ContributionFilters = {
  status: ContributionStatus | "all";
  provenance: SpeakerFilter;
};

type FilterChange = {
  status?: ContributionStatus | "all";
  provenance?: SpeakerFilter;
};

/**
 * The next filter state after one dropdown changes, keeping the other where it stood.
 *
 * A key present in `next` always wins, even set to `undefined` -- FilterChip's own way of
 * saying "reset to any", which this maps back to "all". A key simply absent from `next` (the
 * dimension that did not change) is the only case that falls back to `current`.
 */
export function nextContributionFilters(
  current: ContributionFilters,
  next: FilterChange,
): ContributionFilters {
  return {
    status: "status" in next ? (next.status ?? "all") : current.status,
    provenance: "provenance" in next ? (next.provenance ?? "all") : current.provenance,
  };
}

/** nextContributionFilters, turned into the href /contributions's own rows read back. */
export function contributionsHref(current: ContributionFilters, next: FilterChange): string {
  const filters = nextContributionFilters(current, next);
  const params = new URLSearchParams({ status: filters.status, provenance: filters.provenance });
  return `/contributions?${params}`;
}

/**
 * Whether one row's NPC provenance satisfies a Speaker dropdown selection -- the server-side
 * half of the filter, called from page.tsx's own row projection, not just the UI's idea of what
 * is selected.
 *
 * `undefined` (a row with no npc at all) never matches a real filter: "which rows never named an
 * NPC" isn't a Speaker option, so such a row only survives when nothing is narrowing at all.
 */
export function matchesSpeaker(provenance: Provenance | undefined, filter: SpeakerFilter): boolean {
  if (filter === "all") return true;
  if (provenance === undefined) return false;
  if (filter === NEEDS_DECISION) return provenance === "client" || provenance === "none";
  return provenance === filter;
}

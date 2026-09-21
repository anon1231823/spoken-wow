/**
 * The query string /contributions's two filter dropdowns write to.
 *
 * A free function, not inlined in ContributionTable's click handler, so the mapping -- combine
 * whichever dimension just changed with the other as it stands, the same rule ReportTable's own
 * `go` follows -- can be pinned by a test without rendering FilterChip or a page. Node-free, like
 * contributions.ts and npc.ts, whose types this one only composes: ContributionTable is a client
 * component and calls this directly on every dropdown change.
 */
import type { ContributionStatus } from "./contributions";
import type { Provenance } from "../npc/npc";

export type ContributionFilters = {
  status: ContributionStatus | "all";
  provenance: Provenance | "all";
};

type FilterChange = {
  status?: ContributionStatus | "all";
  provenance?: Provenance | "all";
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

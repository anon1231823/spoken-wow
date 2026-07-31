"use client";

import { forwardRef, useCallback, useMemo } from "react";

import DateChip from "@/components/DateChip";
import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Facets } from "@/lib/facets";
import { ISSUE_GROUPS, ISSUE_GROUP_LABELS } from "@/lib/issues/issues";
import { NPC_TYPES, SOURCES } from "@/lib/line-fields";
import { activeFilterCount } from "@/lib/active-filters";
import type { Filter, LineFilters } from "@/lib/search";

type Props = {
  query: string;
  filters: LineFilters;
  facets: Facets;
  onQuery: (value: string) => void;
  onFilters: (next: Partial<LineFilters>) => void;
  onClearAll: () => void;
};

/** Corpus values, which label themselves. */
function plainOptions(values: readonly string[]): ChipOption[] {
  return values.map((value) => ({ value, label: value }));
}

/** Where the free-text query is matched. "any" is the idle state, so it is not an option. */
const SCOPE_OPTIONS: ChipOption[] = [
  { value: "npc", label: "NPC only" },
  { value: "quest", label: "Quest only" },
  { value: "text", label: "Line text only" },
];

const ISSUE_OPTIONS: ChipOption[] = [
  { value: "1", label: "will break" },
  { value: "2", label: "likely wrong or worse" },
  { value: "3", label: "has any issue" },
];

const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { query, filters, facets, onQuery, onFilters, onClearAll },
  ref,
) {
  const active = activeFilterCount({ ...filters, q: query });

  /** The flavors reachable under a race and gender, or all of them under neither. */
  const flavorsUnder = useCallback(
    (race: string | undefined, gender: string | undefined) => {
      if (!race && !gender) return facets.flavors;
      const reachable = facets.flavorScopes.filter(
        (scope) => (!race || scope.race === race) && (!gender || scope.gender === gender),
      );
      return [...new Set(reachable.map((scope) => scope.flavor))].sort((a, b) =>
        a.localeCompare(b),
      );
    },
    [facets.flavors, facets.flavorScopes],
  );

  const flavorOptions = useMemo(
    () => flavorsUnder(filters.race, filters.gender),
    [flavorsUnder, filters.race, filters.gender],
  );

  /**
   * The flavor to keep when the race or gender changes under it.
   *
   * Dropped when the new pairing has no such voice - picking "tauren" while "priestess" is
   * selected would otherwise leave a filter matching nothing, with the reason two dropdowns
   * away from where you clicked.
   */
  function keptFlavor(next: { race?: string; gender?: string }) {
    if (!filters.flavor) return undefined;
    const race = "race" in next ? next.race : filters.race;
    const gender = "gender" in next ? next.gender : filters.gender;
    return flavorsUnder(race, gender).includes(filters.flavor) ? filters.flavor : undefined;
  }

  return (
    <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b py-3">
      <Input
        ref={ref}
        type="search"
        value={query}
        placeholder="NPC, quest, or what the line says…"
        aria-label="Search"
        autoFocus
        className="min-w-0 flex-1 basis-64"
        onChange={(e) => onQuery(e.target.value)}
      />
      <FilterChip
        label="search in"
        value={filters.filter === "any" ? undefined : filters.filter}
        options={SCOPE_OPTIONS}
        onChange={(value) => onFilters({ filter: (value ?? "any") as Filter })}
      />

      <div className="flex w-full flex-wrap items-center gap-2">
        <FilterChip
          label="race"
          value={filters.race}
          options={plainOptions(facets.races)}
          onChange={(race) => onFilters({ race, flavor: keptFlavor({ race }) })}
        />
        <FilterChip
          label="gender"
          value={filters.gender}
          options={plainOptions(facets.genders)}
          onChange={(gender) => onFilters({ gender, flavor: keptFlavor({ gender }) })}
        />
        <FilterChip
          label="flavor"
          value={filters.flavor}
          options={plainOptions(flavorOptions)}
          onChange={(flavor) => onFilters({ flavor })}
        />
        <FilterChip
          label="voice"
          value={filters.voice}
          options={plainOptions(facets.voices)}
          onChange={(voice) => onFilters({ voice })}
        />
        <FilterChip
          label="source"
          value={filters.source}
          options={plainOptions(SOURCES)}
          onChange={(source) => onFilters({ source: source as LineFilters["source"] })}
        />
        <FilterChip
          label="type"
          value={filters.npcType}
          options={plainOptions(NPC_TYPES)}
          onChange={(npcType) => onFilters({ npcType: npcType as LineFilters["npcType"] })}
        />

        {/* Severity as one dropdown rather than a checkbox plus a level, because "has an
            issue" and "has a bad one" are the same question asked at different strengths. */}
        <FilterChip
          label="issues"
          value={filters.issues === undefined ? undefined : String(filters.issues)}
          options={ISSUE_OPTIONS}
          onChange={(value) =>
            onFilters({ issues: value === undefined ? undefined : (Number(value) as 1 | 2 | 3) })
          }
        />

        <FilterChip
          label="kind"
          value={filters.issueCategory}
          options={ISSUE_GROUPS.map((group) => ({
            value: group,
            label: ISSUE_GROUP_LABELS[group],
          }))}
          onChange={(issueCategory) => onFilters({ issueCategory })}
        />
        {/* Read as one range: "generated after X" and "generated before Y". A file the app
            has never written has no date, and counts as generated long ago - so it sits in
            every "before" and no "after". */}
        <DateChip
          label="generated after"
          value={filters.generatedAfter}
          onChange={(generatedAfter) => onFilters({ generatedAfter })}
        />
        <DateChip
          label="generated before"
          value={filters.generatedBefore}
          onChange={(generatedBefore) => onFilters({ generatedBefore })}
        />

        <div className="flex items-center gap-2 whitespace-nowrap">
          <Checkbox
            id="missing-only"
            checked={filters.missingOnly ?? false}
            onCheckedChange={(value) => onFilters({ missingOnly: value === true })}
          />
          <Label htmlFor="missing-only" className="text-muted-foreground text-sm">
            missing audio only
          </Label>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Checkbox
            id="overridden-only"
            checked={filters.overridden ?? false}
            onCheckedChange={(value) => onFilters({ overridden: value === true })}
          />
          <Label htmlFor="overridden-only" className="text-muted-foreground text-sm">
            rewritten only
          </Label>
        </div>

        {/* Only when there is something to clear: a button that does nothing on most visits
            is one more thing to read past every time. */}
        {active > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onClearAll}>
            Clear {active === 1 ? "filter" : `all ${active} filters`}
          </Button>
        )}
      </div>
    </div>
  );
});

export default SearchBar;

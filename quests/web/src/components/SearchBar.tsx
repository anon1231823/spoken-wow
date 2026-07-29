"use client";

import { forwardRef } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Facets } from "@/lib/facets";
import { NPC_TYPES, SOURCES } from "@/lib/line-fields";
import type { Filter, LineFilters } from "@/lib/search";

/**
 * The value a dropdown carries when it is not filtering.
 *
 * Radix rejects an item with an empty value - it reserves that for "nothing selected" - so
 * "not filtering" needs a name of its own, mapped back to undefined on the way out.
 */
const ANY = "any";

type Props = {
  query: string;
  filters: LineFilters;
  facets: Facets;
  onQuery: (value: string) => void;
  onFilters: (next: Partial<LineFilters>) => void;
};

/** One dropdown over a closed set of corpus values, with an "any" escape at the top. */
function Facet({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => onChange(next === ANY ? undefined : next)}
    >
      <SelectTrigger className="w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{label}: any</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { query, filters, facets, onQuery, onFilters },
  ref,
) {
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
      <Select
        value={filters.filter ?? "any"}
        onValueChange={(value) => onFilters({ filter: value as Filter })}
      >
        <SelectTrigger className="w-40" aria-label="Search in">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Everything</SelectItem>
          <SelectItem value="npc">NPC only</SelectItem>
          <SelectItem value="quest">Quest only</SelectItem>
          <SelectItem value="text">Line text only</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex w-full flex-wrap items-center gap-2">
        <Facet
          label="race"
          value={filters.race}
          options={facets.races}
          onChange={(race) => onFilters({ race })}
        />
        <Facet
          label="gender"
          value={filters.gender}
          options={facets.genders}
          onChange={(gender) => onFilters({ gender })}
        />
        <Facet
          label="voice"
          value={filters.voice}
          options={facets.voices}
          onChange={(voice) => onFilters({ voice })}
        />
        <Facet
          label="source"
          value={filters.source}
          options={SOURCES}
          onChange={(source) => onFilters({ source: source as LineFilters["source"] })}
        />
        <Facet
          label="type"
          value={filters.npcType}
          options={NPC_TYPES}
          onChange={(npcType) => onFilters({ npcType: npcType as LineFilters["npcType"] })}
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
      </div>
    </div>
  );
});

export default SearchBar;

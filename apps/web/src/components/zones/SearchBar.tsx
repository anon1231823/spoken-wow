"use client";

import DateChip from "@/components/DateChip";
import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ZoneFacet } from "@/lib/zones/catalogue";
import {
  activeFilterCount,
  FIELDS,
  FLAGS,
  KINDS,
  STATES,
  type LineFilters,
} from "@/lib/zones/filters";

/**
 * The same controls the quests explorer uses, on this section's fields.
 *
 * They were plain <select>s and bare checkboxes until the merge, for the honest reason that
 * the zones site had no component library to borrow from. It does now, and two explorers in
 * one app that filter differently read as two apps.
 */

/** Values that label themselves. */
function plainOptions(values: readonly string[]): ChipOption[] {
  return values.map((value) => ({ value, label: value }));
}

/** Where the free-text query is matched. "any" is the idle state, so it is not an option. */
const FIELD_OPTIONS: ChipOption[] = FIELDS.filter((field) => field !== "any").map((field) => ({
  value: field,
  label: `${field} only`,
}));

const KIND_OPTIONS: ChipOption[] = KINDS.map((kind) => ({ value: kind, label: `${kind}s only` }));

type Props = {
  zones: ZoneFacet[];
  filters: LineFilters;
  /**
   * Editor and up. Gates the "reported" control only, not the filter behind it: a
   * hand-typed ?fb=open still works for anyone, which is fine because the open counts
   * travel with the search results anyway. Drawing the control for a guest would be
   * offering a worklist to somebody with no work to do.
   */
  canReview: boolean;
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  /** Enter, meaning "search now" rather than waiting out the debounce. */
  onQuerySubmit: () => void;
  onChange: (next: Partial<LineFilters>) => void;
  onClearAll: () => void;
};

export function SearchBar({
  zones,
  filters,
  canReview,
  query,
  inputRef,
  onQueryChange,
  onQuerySubmit,
  onChange,
  onClearAll,
}: Props) {
  const active = activeFilterCount(filters);

  return (
    <div className="bg-background sticky top-0 z-20 border-b">
      <div className="shell flex flex-wrap items-center gap-2 py-3">
        <Input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search lore, names, zones…"
          aria-label="Search"
          autoFocus
          className="min-w-0 flex-1 basis-64"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Nothing here is inside a <form>, so this is not a submit being prevented:
            // it stops the browser's own "search" behaviour on a type=search input.
            event.preventDefault();
            onQuerySubmit();
          }}
        />
        <FilterChip
          label="search in"
          value={filters.field === "any" ? undefined : filters.field}
          options={FIELD_OPTIONS}
          onChange={(field) => onChange({ field: (field ?? "any") as LineFilters["field"] })}
        />

        <div className="flex w-full flex-wrap items-center gap-2">
          {/* The count rides in the label rather than in a column of its own: it is what
              makes one zone worth picking over another. */}
          <FilterChip
            label="zone"
            value={filters.mapID === undefined ? undefined : String(filters.mapID)}
            options={zones.map((zone) => ({
              value: String(zone.mapID),
              label: `${zone.name} (${zone.lines})`,
            }))}
            onChange={(mapID) => onChange({ mapID: mapID === undefined ? undefined : Number(mapID) })}
          />
          <FilterChip
            label="kind"
            value={filters.kind}
            options={KIND_OPTIONS}
            onChange={(kind) => onChange({ kind: kind as LineFilters["kind"] })}
          />
          <FilterChip
            label="state"
            value={filters.state}
            options={plainOptions(STATES)}
            onChange={(state) => onChange({ state: state as LineFilters["state"] })}
          />
          <FilterChip
            label="review"
            value={filters.flag}
            options={plainOptions(FLAGS)}
            onChange={(flag) => onChange({ flag: flag as LineFilters["flag"] })}
          />

          {/* Read as one range: "generated after X" and "generated before Y". */}
          <DateChip
            label="generated after"
            value={filters.generatedAfter}
            onChange={(generatedAfter) => onChange({ generatedAfter })}
          />
          <DateChip
            label="generated before"
            value={filters.generatedBefore}
            onChange={(generatedBefore) => onChange({ generatedBefore })}
          />

          <div className="flex items-center gap-2 whitespace-nowrap">
            <Checkbox
              id="short-only"
              checked={filters.short ?? false}
              onCheckedChange={(value) => onChange({ short: value === true || undefined })}
            />
            <Label htmlFor="short-only" className="text-muted-foreground text-sm">
              short only
            </Label>
          </div>

          {canReview && (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Checkbox
                id="reported-only"
                checked={filters.reports === "open"}
                onCheckedChange={(value) =>
                  onChange({ reports: value === true ? "open" : undefined })
                }
              />
              <Label htmlFor="reported-only" className="text-muted-foreground text-sm">
                reported only
              </Label>
            </div>
          )}

          {/* Only when there is something to clear: a button that does nothing on most
              visits is one more thing to read past every time. */}
          {active > 0 && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={onClearAll}>
              Clear {active === 1 ? "filter" : `all ${active} filters`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

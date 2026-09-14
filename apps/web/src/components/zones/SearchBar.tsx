"use client";

import { X } from "lucide-react";

import type { ZoneFacet } from "@/lib/zones/catalogue";
import {
  activeFilterCount,
  FIELDS,
  FLAGS,
  KINDS,
  STATES,
  type LineFilters,
} from "@/lib/zones/filters";

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
    <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="shell flex flex-wrap items-center gap-2 py-2">
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search lore, names, zones…   ( / )"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Nothing here is inside a <form>, so this is not a submit being prevented:
            // it stops the browser's own "search" behaviour on a type=search input.
            event.preventDefault();
            onQuerySubmit();
          }}
          className="min-w-64 flex-1"
        />

        <select
          value={filters.field ?? "any"}
          onChange={(event) => onChange({ field: event.target.value as LineFilters["field"] })}
          aria-label="Search in"
        >
          {FIELDS.map((field) => (
            <option key={field} value={field}>
              {field === "any" ? "anywhere" : `in ${field}`}
            </option>
          ))}
        </select>

        <select
          value={filters.mapID ?? ""}
          onChange={(event) =>
            onChange({ mapID: event.target.value === "" ? undefined : Number(event.target.value) })
          }
          aria-label="Zone"
        >
          <option value="">all zones</option>
          {zones.map((zone) => (
            <option key={zone.mapID} value={zone.mapID}>
              {zone.name} ({zone.lines})
            </option>
          ))}
        </select>

        <select
          value={filters.kind ?? ""}
          onChange={(event) =>
            onChange({ kind: (event.target.value || undefined) as LineFilters["kind"] })
          }
          aria-label="Kind"
        >
          <option value="">zones + subzones</option>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}s only
            </option>
          ))}
        </select>

        <select
          value={filters.state ?? ""}
          onChange={(event) =>
            onChange({ state: (event.target.value || undefined) as LineFilters["state"] })
          }
          aria-label="State"
        >
          <option value="">any state</option>
          {STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>

        <select
          value={filters.flag ?? ""}
          onChange={(event) =>
            onChange({ flag: (event.target.value || undefined) as LineFilters["flag"] })
          }
          aria-label="Review"
        >
          <option value="">any review</option>
          {FLAGS.map((flag) => (
            <option key={flag} value={flag}>
              {flag}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-muted-foreground" title="Under 250 spoken characters">
          <input
            type="checkbox"
            checked={filters.short ?? false}
            onChange={(event) => onChange({ short: event.target.checked || undefined })}
          />
          short
        </label>

        {canReview && (
          <label
            className="flex items-center gap-1.5 text-muted-foreground"
            title="Lines carrying at least one unresolved visitor report"
          >
            <input
              type="checkbox"
              checked={filters.reports === "open"}
              onChange={(event) => onChange({ reports: event.target.checked ? "open" : undefined })}
            />
            reported
          </label>
        )}

        {/* Read as one range: "generated after X" and "generated before Y". Native date
            inputs rather than the sibling's calendar popover: this app has no component
            library to borrow one from, and the browser's picker answers the same
            "since roughly when?" question. */}
        <label className="flex items-center gap-1.5 text-muted-foreground" title="Take generated on or after this day">
          <span>after</span>
          <input
            type="date"
            value={filters.generatedAfter ?? ""}
            onChange={(event) => onChange({ generatedAfter: event.target.value || undefined })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground" title="Take generated before this day">
          <span>before</span>
          <input
            type="date"
            value={filters.generatedBefore ?? ""}
            onChange={(event) => onChange({ generatedBefore: event.target.value || undefined })}
          />
        </label>

        {active > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={12} />
            clear {active}
          </button>
        )}
      </div>
    </div>
  );
}

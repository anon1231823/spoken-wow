"use client";

import { X } from "lucide-react";

import type { ZoneFacet } from "@/lib/catalogue";
import {
  activeFilterCount,
  FIELDS,
  FLAGS,
  KINDS,
  STATES,
  type LineFilters,
} from "@/lib/filters";

type Props = {
  zones: ZoneFacet[];
  filters: LineFilters;
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onChange: (next: Partial<LineFilters>) => void;
  onClearAll: () => void;
};

export function SearchBar({
  zones,
  filters,
  query,
  inputRef,
  onQueryChange,
  onChange,
  onClearAll,
}: Props) {
  const active = activeFilterCount(filters);

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur">
      <div className="shell flex flex-wrap items-center gap-2 py-2">
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search lore, names, zones…   ( / )"
          onChange={(event) => onQueryChange(event.target.value)}
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

        <label className="flex items-center gap-1.5 text-muted" title="Under 250 spoken characters">
          <input
            type="checkbox"
            checked={filters.short ?? false}
            onChange={(event) => onChange({ short: event.target.checked || undefined })}
          />
          short
        </label>

        {active > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-muted hover:bg-panel-hover hover:text-fg"
          >
            <X size={12} />
            clear {active}
          </button>
        )}
      </div>
    </div>
  );
}

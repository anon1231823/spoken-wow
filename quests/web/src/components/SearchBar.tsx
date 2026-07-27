"use client";

import { forwardRef } from "react";

import type { Filter } from "@/lib/search";

type Props = {
  query: string;
  filter: Filter;
  missingOnly: boolean;
  onQuery: (value: string) => void;
  onFilter: (value: Filter) => void;
  onMissingOnly: (value: boolean) => void;
};

const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { query, filter, missingOnly, onQuery, onFilter, onMissingOnly },
  ref,
) {
  return (
    <div className="search">
      <input
        ref={ref}
        type="search"
        value={query}
        placeholder="NPC name or id, quest title or id…"
        aria-label="Search"
        autoFocus
        onChange={(e) => onQuery(e.target.value)}
      />
      <select
        value={filter}
        aria-label="Search in"
        onChange={(e) => onFilter(e.target.value as Filter)}
      >
        <option value="any">NPC or quest</option>
        <option value="npc">NPC only</option>
        <option value="quest">Quest only</option>
      </select>
      <label className="toggle">
        <input
          type="checkbox"
          checked={missingOnly}
          onChange={(e) => onMissingOnly(e.target.checked)}
        />
        missing audio only
      </label>
    </div>
  );
});

export default SearchBar;

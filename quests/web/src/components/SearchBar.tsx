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
    <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b py-3">
      <Input
        ref={ref}
        type="search"
        value={query}
        placeholder="NPC name or id, quest title or id…"
        aria-label="Search"
        autoFocus
        className="min-w-0 flex-1 basis-64"
        onChange={(e) => onQuery(e.target.value)}
      />
      <Select value={filter} onValueChange={(value) => onFilter(value as Filter)}>
        <SelectTrigger className="w-40" aria-label="Search in">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">NPC or quest</SelectItem>
          <SelectItem value="npc">NPC only</SelectItem>
          <SelectItem value="quest">Quest only</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <Checkbox
          id="missing-only"
          checked={missingOnly}
          onCheckedChange={(value) => onMissingOnly(value === true)}
        />
        <Label htmlFor="missing-only" className="text-muted-foreground text-sm">
          missing audio only
        </Label>
      </div>
    </div>
  );
});

export default SearchBar;

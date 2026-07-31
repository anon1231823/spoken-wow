"use client";

import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import { categoryGroup, categoryLabel, SEVERITY_LABELS, type LineIssues, type Severity } from "@/lib/issues/issues";

/**
 * Severity as colour, and only three of them, because a row already carries a lot of ink.
 *
 * Red is the store's existing colour for "something is wrong here" - it is what a missing
 * audio gap is drawn in - so a severity-1 finding matching it is the point rather than a
 * clash. Amber is hand-rolled the way LexiconEditor's Banner does it: the badge has no amber
 * variant, and adding one to a shared primitive for a single caller is worse than this line.
 */
const TONES: Record<Severity, string> = {
  1: "bg-destructive/10 text-destructive",
  2: "bg-amber-500/10 text-amber-300",
  3: "bg-muted text-muted-foreground",
};

/** The group a finding belongs to, which is as much as fits in a table cell. */
const GROUP_LABELS: Record<string, string> = {
  name: "name",
  roleplay: "role-play",
  abbrev: "abbrev",
  number: "number",
  punct: "punct",
  sfx: "sound",
  dialect: "dialect",
  bug: "bug",
};

/**
 * What is wrong with one line, in a table cell.
 *
 * The severity is the badge and the groups are the words, because the severity is what decides
 * whether to look and the group is what decides where to go next. The full category list is in
 * the title, so hovering answers the question the cell was too narrow to.
 */
export default function IssueChip({ issue }: { issue: LineIssues }) {
  const groups = [...new Set(issue.categories.map(categoryGroup))];
  const detail = issue.categories.map(categoryLabel).join(", ");

  return (
    <span
      className="flex flex-wrap items-center gap-1"
      title={`${SEVERITY_LABELS[issue.severity]}: ${detail}`}
    >
      <Badge className={cn("px-1.5", TONES[issue.severity])}>{issue.severity}</Badge>
      <span className="text-muted-foreground truncate text-xs">
        {groups.map((g) => GROUP_LABELS[g] ?? g).join(" · ")}
      </span>
    </span>
  );
}

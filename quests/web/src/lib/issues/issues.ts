/**
 * What the hiccup scan found: shapes, labels and validation.
 *
 * No node:fs and no pg, for the reason lib/generation/lexicon.ts has none: the explorer and
 * the review queue are client components that need the labels and must be able to check a
 * draft before sending it, without dragging the server's dependencies into the bundle.
 *
 * A finding is a detection, not a defect: `Ashenvale` appearing 199 times is a fact about the
 * corpus, and whether it is a problem depends on whether the lexicon covers it and whether a
 * person listening agreed. Detections come from corpus/hiccups.json.gz and are replaced on
 * every load; verdicts are authored here and survive one.
 */

/** 1 will mispronounce or read out junk, 2 likely wrong, 3 long tail. */
export const SEVERITIES = [1, 2, 3] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  1: "Will break",
  2: "Likely wrong",
  3: "Long tail",
};

export const VERDICTS = ["open", "fixed", "dismissed"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  open: "Open",
  fixed: "Fixed",
  dismissed: "Not a problem",
};

/**
 * Deliberately not a closed union. The scan grows categories faster than a migration can
 * follow, and an unfamiliar one should render as itself rather than crash a page - so this is
 * a lookup with a fallback, and `categoryLabel` is the only way to read it.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  "name-apostrophe": "Apostrophe name",
  "name-drifts-to-english": "Drifts to an English word",
  "name-invented": "Invented name",
  "name-compound": "Compound name",
  "roleplay-asterisk": "Stage direction",
  "roleplay-parenthetical": "Parenthetical aside",
  "abbrev-initial": "Initials",
  "abbrev-title": "Abbreviation",
  "abbrev-code": "Alphanumeric code",
  "abbrev-roman": "Roman numeral",
  "number-binary": "Raw binary",
  "number-time": "Time of day",
  "number-bare": "Numeral",
  "punct-double-hyphen": "Double hyphen",
  "punct-ellipsis": "Long ellipsis",
  "punct-repeat": "Repeated punctuation",
  "punct-symbol": "Symbol",
  "sfx-elongation": "Elongated sound",
  "sfx-stutter": "Stutter",
  "dialect-contraction": "Dialect contraction",
  "bug-glued-substitution": "Glued substitution",
  "bug-source-typo": "Typo in Blizzard's text",
  "bug-degenerate-line": "Degenerate line",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * The groups the filter bar offers, in the order they are worth looking at.
 *
 * Written out rather than derived from CATEGORY_LABELS, because a dropdown's order is an
 * editorial decision and alphabetical would put `abbrev` above `name`.
 */
export const ISSUE_GROUPS = ["name", "bug", "roleplay", "abbrev", "number", "sfx", "dialect", "punct"];

export const ISSUE_GROUP_LABELS: Record<string, string> = {
  name: "names",
  bug: "text bugs",
  roleplay: "role-play",
  abbrev: "abbreviations",
  number: "numbers",
  sfx: "sound effects",
  dialect: "dialect",
  punct: "punctuation",
};

/**
 * The half of a category before the first hyphen: name, roleplay, abbrev, number, punct,
 * sfx, dialect, bug. Derived rather than tabulated so a new category joins a group for free.
 */
export function categoryGroup(category: string): string {
  const cut = category.indexOf("-");
  return cut === -1 ? category : category.slice(0, cut);
}

/** Only a name finding can be answered by a lexicon entry. */
export function fixableByLexicon(issue: { grapheme: string | null }): boolean {
  return issue.grapheme !== null;
}

export type Issue = {
  id: number;
  category: string;
  item: string;
  severity: Severity;
  note: string;
  occurrences: number;
  variants: string | null;
  grapheme: string | null;
  verdict: Verdict;
  verdictNote: string | null;
  verdictBy: string | null;
  verdictAt: string | null;
  /** How many corpus lines this finding touches, which `occurrences` is not. */
  lineCount: number;
  /** False once a load has run without seeing it - usually because the lexicon now covers it. */
  detected: boolean;
};

/** What the explorer needs about one line, collapsed from however many findings touch it. */
export type LineIssues = {
  severity: Severity;
  categories: string[];
};

export class IssueError extends Error {}

/**
 * Whether the lexicon already answers a name finding.
 *
 * A mirror of the `covered` set in tools/scan_corpus_hiccups.py, which is where this rule was
 * worked out and where it can be checked against the corpus. Both sides compare lowercased,
 * because a lexicon entry is written once and its casings are derived (lib/generation/casings.ts).
 *
 * The prefix arms are what make it useful rather than exact: an entry for `Gnomeregan` should
 * also answer `Gnomeregan's`, and one for `Hakkar` should answer `Hakkari`. Six characters is
 * the floor because below it the arms start matching names that merely rhyme.
 */
export function coveredByLexicon(grapheme: string, graphemes: Set<string>): boolean {
  const g = grapheme.toLowerCase();
  if (graphemes.has(g)) return true;
  if (g.endsWith("s") && graphemes.has(g.replace(/s+$/, ""))) return true;
  for (const entry of graphemes) {
    if (entry.length > 5 && (g.startsWith(entry) || entry.startsWith(g))) return true;
  }
  return false;
}

export function validateVerdict(input: unknown): { verdict: Verdict; note: string | null } {
  if (!input || typeof input !== "object") throw new IssueError("expected a verdict object");
  const body = input as Record<string, unknown>;

  const verdict = body.verdict;
  if (typeof verdict !== "string" || !(VERDICTS as readonly string[]).includes(verdict)) {
    throw new IssueError(`verdict must be one of ${VERDICTS.join(", ")}`);
  }

  const note = body.note ?? null;
  if (note !== null && typeof note !== "string") throw new IssueError("note must be text");
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > 500) throw new IssueError("note is too long (500 characters)");

  return { verdict: verdict as Verdict, note: trimmed || null };
}

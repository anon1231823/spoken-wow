/**
 * Reading and writing what the scan found.
 *
 * Two very different jobs, kept in one module because they share a table:
 *
 *   loadFindings   replaces the detections wholesale from corpus/hiccups.json.gz, refreshing
 *                  counts and affected lines while leaving every verdict alone.
 *   issuesByLine   answers "what is wrong with this line" for every row of every search page,
 *                  which means it must be cheap and must not be stale.
 *
 * The lexicon is consulted here rather than in the scan, because only the live row knows what
 * is covered - see the header of migration 0011.
 */
import { db } from "../db";
import { readLexicon } from "../generation/dictionary";
import {
  type Issue,
  type LineIssues,
  type Severity,
  type Verdict,
  coveredByLexicon,
} from "./issues";

/** One finding as corpus/hiccups.json.gz writes it. */
export type Finding = {
  category: string;
  item: string;
  severity: number;
  note: string;
  occurrences: number;
  variants: string | null;
  grapheme: string | null;
  lineIds: string[];
};

export type LoadReport = {
  /** Findings in the artifact. */
  scanned: number;
  /** Findings written, i.e. those the lexicon does not already answer. */
  loaded: number;
  /** Name findings skipped because a lexicon entry covers them. */
  coveredByLexicon: number;
  /** Rows that survived from an earlier load but this one did not see. */
  undetected: number;
  lineLinks: number;
  scanAt: string;
};

/**
 * Replace the detections, keep the decisions.
 *
 * One transaction, because a half-loaded table would mark some lines and not others with no
 * way to tell which - and the explorer would look like it had opinions it does not have.
 *
 * Findings the lexicon covers are not written at all. They are detections that have been
 * answered, and writing them so the UI can hide them again would only mean explaining, in two
 * places, why 144 rows nobody can act on are there.
 */
export async function loadFindings(findings: Finding[]): Promise<LoadReport> {
  const lexicon = await readLexicon();
  const graphemes = new Set(lexicon.entries.map((e) => e.grapheme.toLowerCase()));

  const wanted = findings.filter(
    (f) => !(f.grapheme && coveredByLexicon(f.grapheme, graphemes)),
  );

  const scanAt = new Date().toISOString();
  const client = await db().connect();
  try {
    await client.query("begin");

    let lineLinks = 0;
    for (const f of wanted) {
      const { rows } = await client.query<{ id: string }>(
        `insert into "line_issue"
           ("category", "item", "severity", "note", "occurrences", "variants", "grapheme", "scanAt")
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict ("category", "item") do update
            set "severity"    = excluded."severity",
                "note"        = excluded."note",
                "occurrences" = excluded."occurrences",
                "variants"    = excluded."variants",
                "grapheme"    = excluded."grapheme",
                "scanAt"      = excluded."scanAt"
         returning "id"`,
        [f.category, f.item, f.severity, f.note, f.occurrences, f.variants, f.grapheme, scanAt],
      );
      const id = rows[0].id;

      // Replaced rather than merged: a line that stopped saying the thing must stop being
      // marked, and an upsert alone can only ever add.
      await client.query(`delete from "line_issue_line" where "issueId" = $1`, [id]);
      await client.query(
        `insert into "line_issue_line" ("issueId", "lineId")
         select $1, unnest($2::text[])`,
        [id, f.lineIds],
      );
      lineLinks += f.lineIds.length;
    }

    const { rows: stale } = await client.query<{ count: string }>(
      `select count(*)::text as count from "line_issue" where "scanAt" <> $1`,
      [scanAt],
    );

    await client.query("commit");
    // The stamp would notice on the next read, but not reliably in the same millisecond -
    // and the person who just pressed "Reload scan" is the one watching for the change.
    forgetIssues();
    return {
      scanned: findings.length,
      loaded: wanted.length,
      coveredByLexicon: findings.length - wanted.length,
      undetected: Number(stale[0].count),
      lineLinks,
      scanAt,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function setVerdict(
  id: number,
  verdict: Verdict,
  note: string | null,
  // Nullable to match the column, which is SET NULL: who decided outlives the account, and a
  // verdict whose author has been deleted is still a decision worth keeping.
  userId: string | null,
): Promise<void> {
  await db().query(
    `update "line_issue"
        set "verdict" = $2, "verdictNote" = $3, "verdictBy" = $4, "verdictAt" = now()
      where "id" = $1`,
    [id, verdict, note, userId],
  );
  forgetIssues();
}

type IssueRow = {
  id: string;
  category: string;
  item: string;
  severity: number;
  note: string;
  occurrences: number;
  variants: string | null;
  grapheme: string | null;
  verdict: Verdict;
  verdictNote: string | null;
  verdictBy: string | null;
  verdictAt: Date | null;
  lineCount: string;
  detected: boolean;
};

function toIssue(row: IssueRow): Issue {
  return {
    id: Number(row.id),
    category: row.category,
    item: row.item,
    severity: row.severity as Severity,
    note: row.note,
    occurrences: row.occurrences,
    variants: row.variants,
    grapheme: row.grapheme,
    verdict: row.verdict,
    verdictNote: row.verdictNote,
    verdictBy: row.verdictBy,
    verdictAt: row.verdictAt?.toISOString() ?? null,
    lineCount: Number(row.lineCount),
    detected: row.detected,
  };
}

export type IssueQuery = {
  category?: string;
  group?: string;
  severity?: number;
  verdict?: Verdict;
  q?: string;
  /** Rows the newest load did not see. Off by default: they are answered, not pending. */
  includeUndetected?: boolean;
  limit?: number;
};

/** The review queue's rows: one per finding, newest scan first, worst severity first. */
export async function issueList(query: IssueQuery = {}): Promise<Issue[]> {
  const { rows } = await db().query<IssueRow>(
    `with newest as (select max("scanAt") as at from "line_issue")
     select i.*,
            (select count(*) from "line_issue_line" l where l."issueId" = i."id")::text as "lineCount",
            (i."scanAt" = newest.at) as "detected"
       from "line_issue" i, newest
      where ($1::text is null or i."category" = $1)
        and ($2::text is null or split_part(i."category", '-', 1) = $2)
        and ($3::int  is null or i."severity" = $3)
        and ($4::text is null or i."verdict" = $4)
        and ($5::text is null or i."item" ilike '%' || $5 || '%' or i."note" ilike '%' || $5 || '%')
        and ($6::boolean or i."scanAt" = newest.at)
      order by i."severity", i."occurrences" desc, i."category", i."item"
      limit $7`,
    [
      query.category ?? null,
      query.group ?? null,
      query.severity ?? null,
      query.verdict ?? null,
      query.q?.trim() || null,
      query.includeUndetected ?? false,
      query.limit ?? 500,
    ],
  );
  return rows.map(toIssue);
}

/**
 * A cheap stand-in for "have the issues changed", the database analogue of the store's
 * directory mtime: the newest timestamp anything in the table carries. A load moves scanAt, a
 * verdict moves verdictAt, and nothing else in this table can change without moving one.
 */
async function stamp(): Promise<string> {
  const { rows } = await db().query<{ stamp: string | null }>(
    `select max(greatest("scanAt", coalesce("verdictAt", "scanAt")))::text as stamp
       from "line_issue"`,
  );
  return rows[0]?.stamp ?? "-";
}

const cacheKey = Symbol.for("wow-voiceover.line-issues");
type CacheHolder = { [cacheKey]?: { map: Map<string, LineIssues>; stamp: string } };

/**
 * What is wrong with each line, collapsed to the worst severity and the categories involved.
 *
 * Memoised behind the stamp for the reason storeIndex is: search runs on every debounced
 * keystroke, and re-aggregating 16,752 join rows per keystroke is not a thing to do. pm2 runs
 * two workers, so a verdict recorded on one has to become visible on the other without a
 * reload - which the stamp, and only the stamp, arranges.
 *
 * Undetected rows are excluded: the lexicon answering a name is exactly as good as a person
 * dismissing it, and neither should keep marking a row.
 */
export async function issuesByLine(): Promise<Map<string, LineIssues>> {
  const holder = globalThis as CacheHolder;
  const current = await stamp();
  if (holder[cacheKey]?.stamp === current) return holder[cacheKey].map;

  const { rows } = await db().query<{ lineId: string; severity: number; categories: string[] }>(
    `with newest as (select max("scanAt") as at from "line_issue")
     select l."lineId",
            min(i."severity")::int          as "severity",
            array_agg(distinct i."category") as "categories"
       from "line_issue_line" l
       join "line_issue" i on i."id" = l."issueId", newest
      where i."verdict" = 'open' and i."scanAt" = newest.at
      group by l."lineId"`,
  );

  const map = new Map<string, LineIssues>(
    rows.map((r) => [r.lineId, { severity: r.severity as Severity, categories: r.categories }]),
  );
  holder[cacheKey] = { map, stamp: current };
  return map;
}

/** Forget the memo, for a write that has just invalidated it in this worker. */
export function forgetIssues(): void {
  delete (globalThis as CacheHolder)[cacheKey];
}

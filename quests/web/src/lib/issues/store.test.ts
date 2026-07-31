/**
 * Against a real Postgres, deliberately.
 *
 * What this module is for is what survives a reload: a verdict recorded weeks ago must
 * outlive a scan that rewrote every count around it, and a finding the newest scan did not
 * see must stop marking lines without losing the note explaining why. Both are properties of
 * an upsert and a timestamp comparison, which a mocked pg would assert nothing about.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { issueList, issuesByLine, loadFindings, setVerdict } = await import("./store");

/** Unique per run, so tests can share a database and clean up after themselves. */
let tag: string;
let lineA: string;
let lineB: string;

/**
 * The lexicon this test loads against.
 *
 * Its own, not the live single row: dictionary.test.ts rewrites that row, test files run in
 * parallel, and "a covered name is not written" is a claim about the rule rather than about
 * whatever happened to be seeded when this ran.
 */
const LEXICON = new Set(["gnomeregan", "dolanaar"]);

function finding(over: Partial<Parameters<typeof loadFindings>[0][number]> = {}) {
  return {
    category: `test-${tag}`,
    item: "Astranaar",
    severity: 1,
    note: "not English",
    occurrences: 23,
    variants: "Astranaar",
    grapheme: "astranaar",
    lineIds: [lineA, lineB],
    ...over,
  };
}

beforeAll(async () => {
  try {
    await db().query(`select 1 from "line_issue" limit 1`);
  } catch (error) {
    throw new Error(
      "store.test.ts needs a migrated database. Run:\n" +
        '  docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"\n' +
        String(error),
    );
  }
});

afterEach(async () => {
  await db().query(`delete from "line_issue" where "category" like 'test-%'`);
});

afterAll(async () => {
  await closeDb();
});

function fresh() {
  tag = Math.random().toString(16).slice(2, 10);
  lineA = `q:${tag}:accept`;
  lineB = `q:${tag}:complete`;
}

describe("loading findings", () => {
  it("writes each finding once and links every line it touches", async () => {
    fresh();
    const report = await loadFindings([finding()], LEXICON);

    expect(report.loaded).toBe(1);
    expect(report.lineLinks).toBe(2);

    const [issue] = await issueList({ category: `test-${tag}` });
    expect(issue.item).toBe("Astranaar");
    expect(issue.lineCount).toBe(2);
    expect(issue.verdict).toBe("open");
    expect(issue.detected).toBe(true);
  });

  it("does not write a name the lexicon already answers", async () => {
    fresh();
    // The whole reason coverage is decided here and not in the scan: the lexicon is edited
    // from /lexicon, and the seeded copy the scan can read went stale the first time it was.
    const report = await loadFindings([finding({ item: "Gnomeregan", grapheme: "gnomeregan" })], LEXICON);

    expect(report.coveredByLexicon).toBe(1);
    expect(report.loaded).toBe(0);
    expect(await issueList({ category: `test-${tag}` })).toEqual([]);
  });

  it("refreshes the counts a re-scan moved without touching the verdict", async () => {
    fresh();
    await loadFindings([finding()], LEXICON);
    const [before] = await issueList({ category: `test-${tag}` });
    await setVerdict(before.id, "dismissed", "the elves say it fine", null);

    await loadFindings([finding({ occurrences: 41, severity: 2, note: "moved" })], LEXICON);

    const [after] = await issueList({ category: `test-${tag}`, verdict: "dismissed" });
    expect(after.id).toBe(before.id);
    expect(after.occurrences).toBe(41);
    expect(after.severity).toBe(2);
    expect(after.verdict).toBe("dismissed");
    expect(after.verdictNote).toBe("the elves say it fine");
  });

  it("drops a line that stopped saying the thing", async () => {
    fresh();
    await loadFindings([finding()], LEXICON);
    await loadFindings([finding({ lineIds: [lineA] })], LEXICON);

    const [issue] = await issueList({ category: `test-${tag}` });
    expect(issue.lineCount).toBe(1);
  });

  it("keeps a finding the newest scan did not see, but marks it undetected", async () => {
    fresh();
    await loadFindings([finding()], LEXICON);
    await loadFindings([finding({ item: "Splintertree", grapheme: "splintertree" })], LEXICON);

    const current = await issueList({ category: `test-${tag}` });
    expect(current.map((i) => i.item)).toEqual(["Splintertree"]);

    const all = await issueList({ category: `test-${tag}`, includeUndetected: true });
    expect(all.map((i) => i.item).sort()).toEqual(["Astranaar", "Splintertree"]);
    expect(all.find((i) => i.item === "Astranaar")!.detected).toBe(false);
  });
});

describe("issuesByLine", () => {
  it("collapses every finding on a line to the worst severity and the categories involved", async () => {
    fresh();
    await loadFindings(
      [
        finding(),
        finding({ category: `test-${tag}-b`, item: "--", severity: 3, grapheme: null, lineIds: [lineA] }),
      ],
      LEXICON,
    );

    const byLine = await issuesByLine();
    expect(byLine.get(lineA)).toEqual({
      severity: 1,
      categories: expect.arrayContaining([`test-${tag}`, `test-${tag}-b`]),
    });
    expect(byLine.get(lineB)!.categories).toEqual([`test-${tag}`]);
  });

  it("stops marking a line once the finding is answered", async () => {
    fresh();
    await loadFindings([finding()], LEXICON);
    const [issue] = await issueList({ category: `test-${tag}` });

    await setVerdict(issue.id, "fixed", null, null);
    expect((await issuesByLine()).get(lineA)).toBeUndefined();
  });

  it("stops marking a line once the scan no longer detects the finding", async () => {
    fresh();
    await loadFindings([finding()], LEXICON);
    await loadFindings([finding({ item: "Splintertree", grapheme: "splintertree", lineIds: [] })], LEXICON);

    expect((await issuesByLine()).get(lineA)).toBeUndefined();
  });
});

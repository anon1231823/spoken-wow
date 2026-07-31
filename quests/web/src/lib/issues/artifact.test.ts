/**
 * The findings file this release ships, loaded for real.
 *
 * The other tests build findings by hand, which proves the upsert and leaves open the two
 * questions that actually break a deploy: does corpus/hiccups.json.gz still parse as the shape
 * this code reads, and do its lineIds still name lines the corpus has? A scan run against a
 * newer corpus than the one committed would answer no to the second while looking perfectly
 * healthy in every other test.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import fs from "node:fs";
import zlib from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { lineIndex } = await import("@/lib/corpus");
const { HICCUPS_PATH } = await import("@/lib/paths");
const { loadFindings } = await import("./store");
import type { Finding } from "./store";

type Artifact = { schemaVersion: number; generatedAt: string; findings: Finding[] };

/**
 * The category prefix this file writes under, and deletes by.
 *
 * Deliberately not `test-`, which store.test.ts claims and clears wholesale: two files
 * running in parallel, each deleting the other's rows, is the same collision as writing over
 * the real ones - just harder to see.
 */
const NAMESPACE = "artifact-check-";

const artifact: Artifact = JSON.parse(
  zlib.gunzipSync(fs.readFileSync(HICCUPS_PATH)).toString(),
);

beforeAll(async () => {
  try {
    await db().query(`select 1 from "line_issue" limit 1`);
  } catch (error) {
    throw new Error(
      "artifact.test.ts needs a migrated database. Run:\n" +
        '  docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"\n' +
        String(error),
    );
  }
});

afterAll(async () => {
  await closeDb();
});

describe("the committed findings file", () => {
  it("is the schema the loader reads", () => {
    // Bumped together with SCHEMA_VERSION in api/issues/reload. A mismatch here is a scan and
    // a release that went out of order, which is exactly what that route refuses at runtime.
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.findings.length).toBeGreaterThan(3000);
  });

  it("names only lines the committed corpus has", () => {
    const known = lineIndex();
    const missing = new Set<string>();
    for (const finding of artifact.findings) {
      for (const lineId of finding.lineIds) {
        if (!known.has(lineId)) missing.add(lineId);
      }
    }
    // A scan run against a different corpus than the one committed beside it, which would
    // mark nothing and look fine.
    expect([...missing].slice(0, 5)).toEqual([]);
  });

  it("names lines that actually say the thing it found", () => {
    // What /issues' "Lines" link rests on: it carries the item as the explorer's search term
    // beside the exact id filter, so the box says what is being shown. A finding whose item
    // appeared on none of its lines would open a page filtered to nothing.
    const rows = lineIndex();
    const empty: string[] = [];

    for (const finding of artifact.findings) {
      // A degenerate line's item is a lineId - its text is the letter x, or one newline -
      // which is why the link omits the search term for that category alone.
      if (finding.category === "bug-degenerate-line") continue;
      const item = finding.item.toLowerCase();

      for (const lineId of finding.lineIds) {
        const said = rows.get(lineId)?.some((line) => line.text.toLowerCase().includes(item));
        if (!said) empty.push(`${finding.category} "${finding.item}" on ${lineId}`);
      }
    }
    expect(empty.slice(0, 5)).toEqual([]);
  });

  it("carries a grapheme for every name finding and none for the rest", () => {
    for (const finding of artifact.findings) {
      const isName = finding.category.startsWith("name-");
      expect(typeof finding.grapheme === "string").toBe(isName);
    }
  });

  it("loads through the real path, under a category of its own", async () => {
    // Renamed before loading, and this is the whole point of the exercise. `pnpm test` runs
    // against DATABASE_URL, which is a developer's own database with the real findings and
    // real verdicts in it. Loading these under their own names would upsert over those rows,
    // and cleaning up afterwards would delete them - taking the verdicts with them.
    const sample = artifact.findings
      .filter((f) => f.category === "bug-degenerate-line")
      .map((f) => ({ ...f, category: `${NAMESPACE}${f.category}` }));
    expect(sample.length).toBeGreaterThan(0);

    const report = await loadFindings(sample, new Set());
    try {
      expect(report.loaded).toBe(sample.length);
      expect(report.lineLinks).toBe(sample.reduce((n, f) => n + f.lineIds.length, 0));

      const { rows } = await db().query<{ lineId: string }>(
        `select l."lineId" from "line_issue_line" l
           join "line_issue" i on i."id" = l."issueId"
          where i."category" like $1`,
        [`${NAMESPACE}%`],
      );
      // q:1155:accept is the line whose entire text is the letter x.
      expect(rows.map((r) => r.lineId)).toContain("q:1155:accept");
    } finally {
      await db().query(`delete from "line_issue" where "category" like $1`, [`${NAMESPACE}%`]);
    }
  });
});

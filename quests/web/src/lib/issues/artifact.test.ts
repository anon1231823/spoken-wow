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

  it("carries a grapheme for every name finding and none for the rest", () => {
    for (const finding of artifact.findings) {
      const isName = finding.category.startsWith("name-");
      expect(typeof finding.grapheme === "string").toBe(isName);
    }
  });

  it("loads, into its own scan generation, and is taken out again", async () => {
    // Against the real table, so this competes with nothing: it writes the release's own
    // findings, reads back one it knows, and removes exactly what it added.
    const sample = artifact.findings.filter((f) => f.category === "bug-degenerate-line");
    expect(sample.length).toBeGreaterThan(0);

    const report = await loadFindings(sample, new Set());
    try {
      expect(report.loaded).toBe(sample.length);
      expect(report.lineLinks).toBe(sample.reduce((n, f) => n + f.lineIds.length, 0));

      const { rows } = await db().query<{ lineId: string }>(
        `select l."lineId" from "line_issue_line" l
           join "line_issue" i on i."id" = l."issueId"
          where i."category" = 'bug-degenerate-line'`,
      );
      // q:1155:accept is the line whose entire text is the letter x.
      expect(rows.map((r) => r.lineId)).toContain("q:1155:accept");
    } finally {
      await db().query(`delete from "line_issue" where "category" = 'bug-degenerate-line'`);
    }
  });
});

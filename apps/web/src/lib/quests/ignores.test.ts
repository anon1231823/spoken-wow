/**
 * Against a real Postgres, like history.test.ts and for the same reason: what this module
 * promises - one row per line, a reason that cannot be blank, a memo that notices a delete -
 * is kept by the schema and by a stamp read from it, neither of which a mock would exercise.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { clearIgnore, forgetIgnores, readIgnores, writeIgnore } from "./ignores";

/** An id no other run collides with, and one the corpus does not have: this table is free. */
const LINE = `q:999999:accept:test-${process.pid}`;

afterEach(async () => {
  await db().query(`delete from "line_ignore" where "lineId" = $1`, [LINE]);
  forgetIgnores();
});

afterAll(async () => {
  await closeDb();
});

describe("ignores", () => {
  it("records a decision with its reason", async () => {
    const written = await writeIgnore(LINE, "  war-effort tally  ", null);

    expect(written.reason).toBe("war-effort tally");
    expect((await readIgnores()).get(LINE)?.reason).toBe("war-effort tally");
  });

  it("refuses a reason that says nothing", async () => {
    await expect(writeIgnore(LINE, "   ", null)).rejects.toThrow(/reason/);
    expect((await readIgnores()).has(LINE)).toBe(false);
  });

  it("replaces the reason rather than adding a second row", async () => {
    await writeIgnore(LINE, "first", null);
    await writeIgnore(LINE, "second", null);

    const { rows } = await db().query<{ n: string }>(
      `select count(*)::text as n from "line_ignore" where "lineId" = $1`,
      [LINE],
    );
    expect(rows[0].n).toBe("1");
    expect((await readIgnores()).get(LINE)?.reason).toBe("second");
  });

  it("stops hiding a line once the decision is withdrawn", async () => {
    await writeIgnore(LINE, "was broken", null);
    expect((await readIgnores()).has(LINE)).toBe(true);

    expect(await clearIgnore(LINE)).toBe(true);
    // The memo has to notice, which is why the stamp counts rows as well as timestamping
    // them: a delete leaves max(createdAt) exactly where it was.
    expect((await readIgnores()).has(LINE)).toBe(false);
  });

  it("reports nothing removed for a line that was not ignored", async () => {
    expect(await clearIgnore(LINE)).toBe(false);
  });
});

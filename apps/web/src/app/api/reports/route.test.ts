/**
 * The public write path, against a real Postgres.
 *
 * The defences here are the reason this route exists in the shape it does, and every one of
 * them is only observable end to end: a honeypot that returned 400 would still "work" in a
 * unit test of the validator, and a rate limit held in memory would pass one too.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

import { POST } from "./route";

const ip = "203.0.113.99";

function post(body: unknown): Request {
  return new Request("https://example.com/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

function valid(overrides: Record<string, unknown> = {}) {
  return { target: "quest/1/accept", category: "pronunciation", body: "Wrong.", ...overrides };
}

afterEach(async () => {
  await db().query(`delete from "report" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/reports", () => {
  it("writes a report", async () => {
    expect((await POST(post(valid()))).status).toBe(200);

    const { rows } = await db().query<{ target: string }>(
      `select "target" from "report" where "ip" = $1`,
      [ip],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe("quest/1/accept");
  });

  it("answers a filled honeypot with 200 and writes nothing", async () => {
    expect((await POST(post(valid({ website: "http://spam.example" })))).status).toBe(200);

    const { rows } = await db().query(`select 1 from "report" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(0);
  });

  it("rejects an event a quest address cannot carry", async () => {
    expect((await POST(post(valid({ target: "quest/1/gossip" })))).status).toBe(400);
  });

  it("rejects an unknown category", async () => {
    expect((await POST(post(valid({ category: "lore" })))).status).toBe(400);
  });

  it("refuses the eleventh report in an hour", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await POST(post(valid()))).status).toBe(200);
    }

    expect((await POST(post(valid()))).status).toBe(429);
  });

  it("stores no lineId when the claimed line does not belong to the target", async () => {
    await POST(post(valid({ lineId: "g:not-a-real-line" })));

    const { rows } = await db().query<{ lineId: string | null }>(
      `select "lineId" from "report" where "ip" = $1`,
      [ip],
    );
    expect(rows[0].lineId).toBeNull();
  });
});

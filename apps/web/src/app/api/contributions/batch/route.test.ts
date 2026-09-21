/**
 * The batch path, against a real Postgres, for the reasons ../route.test.ts gives.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { readFileSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { MAX_ENVELOPES } from "@/lib/contributions/saved-variables";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/npc/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/npc/resolve")>();
  return { ...actual, resolveNpc: vi.fn(async () => undefined) };
});

import { checksum } from "@/lib/contributions/envelope";
import { resolveNpc } from "@/lib/npc/resolve";

import { POST } from "./route";

const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const fixture = (name: string) =>
  readFileSync(new URL(`../../../../../../../tests/fixtures/contributions/${name}`, import.meta.url), "utf8");
const quests = fixture("quests-accept.txt");
const books = fixture("books-page.txt");
const zones = fixture("zones-subzone.txt");

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions/batch", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

/** A gossip line from npc 9123, checksummed the way the addon's writer does. */
function gossip(words: string): string {
  const body = `!SPOKEN1 quests\naddon=SpokenQuests/2.1.0\nbuild=1.60.1/69913\nlocale=enUS\nnpc=9123 Tester\nkind=creature\ntext<<\n${words}\n>>\n`;
  return `${body}sum=${checksum(body)}\n`;
}

afterEach(async () => {
  vi.mocked(resolveNpc).mockClear();
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
  await db().query(`delete from "contribution_hit" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/contributions/batch", () => {
  it("stores every good envelope and counts the rest by reason", async () => {
    const response = await POST(
      post({ envelopes: [quests, books, zones, quests.replace("9123", "9124"), 7], name: "Tester" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      accepted: 2,
      refused: { describe: 1, checksum: 1, malformed: 1 },
    });

    const { rows } = await db().query<{ source: string; name: string }>(
      `select "source", "name" from "contribution" where "ip" = $1 order by "source"`,
      [ip],
    );
    expect(rows).toEqual([
      { source: "books", name: "Tester" },
      { source: "quests", name: "Tester" },
    ]);
  });

  it("resolves each speaker once, however many of their lines arrive", async () => {
    await POST(post({ envelopes: [gossip("Hail."), gossip("Farewell."), gossip("Well met.")] }));
    expect(resolveNpc).toHaveBeenCalledTimes(1);
  });

  it("counts one upload as one hit against the shared limit", async () => {
    await POST(post({ envelopes: [quests, books] }));
    const hits = await db().query(`select 1 from "contribution_hit" where "ip" = $1`, [ip]);
    expect(hits.rows).toHaveLength(1);
  });

  it("refuses once the hour's allowance is spent", async () => {
    for (let i = 0; i < 10; i++) await POST(post({ envelopes: [books] }));
    expect((await POST(post({ envelopes: [books] }))).status).toBe(429);
  });

  it("refuses an empty upload and an oversized one", async () => {
    expect((await POST(post({ envelopes: [] }))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ envelopes: Array(MAX_ENVELOPES + 1).fill(books) }))).status).toBe(413);
  });

  it("answers a filled honeypot with 200 and writes nothing", async () => {
    expect((await POST(post({ envelopes: [quests], website: "x" }))).status).toBe(200);
    const { rows } = await db().query(`select 1 from "contribution" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(0);
  });
});

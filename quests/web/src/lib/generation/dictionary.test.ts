/**
 * Against a real Postgres, matching history.test.ts and for the same reason.
 *
 * What this module is for is a distinction between three states - never uploaded, uploaded,
 * and saved-but-not-uploaded - and that distinction is a comparison between two timestamps
 * the database writes. A mocked pg would test that `now()` is called, which is not a test.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { currentLocator, readLexicon, resync, sync, writeLexicon } = await import("./dictionary");

const ENTRIES = [
  {
    grapheme: "Gnomeregan",
    ipa: "ˈnoʊmɹəɡæn",
    say: "NOME-reh-gan",
    confidence: "high" as const,
    category: "place" as const,
  },
];

/** An ElevenLabs that accepts the upload and hands back a locator. */
function accepts(id = "dict-abc", version = "ver-1") {
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify({ id, version_id: version }), { status: 200 }),
  );
  return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls: fetchImpl };
}

/** An ElevenLabs that refuses it. */
function refuses(body = '{"detail":"quota exceeded"}') {
  return {
    fetchImpl: vi.fn(async () => new Response(body, { status: 429 })) as unknown as
      typeof globalThis.fetch,
  };
}

const OPTIONS = (fetchImpl: typeof globalThis.fetch) => ({
  apiKey: "test-key",
  baseUrl: "https://stub.invalid",
  fetchImpl,
});

/**
 * The real lexicon, put back after every case.
 *
 * The table holds one row forever and that row IS the lexicon - 134 pronunciations that
 * migration 0008 seeds once and never re-seeds, because migrations are recorded and do not
 * run twice. So a test that deleted it would not be leaving a mess for the next case; it
 * would be destroying the data, permanently, on whatever database DATABASE_URL happens to
 * point at. This file used to call resetLexicon in afterEach, which did exactly that.
 *
 * Snapshotting the whole row rather than just the entries, because the locator and the
 * timestamps are what the sync states are computed from: restoring the entries alone would
 * hand the next reader a lexicon that claims to be synced to a dictionary built from
 * something else.
 */
let snapshot: Record<string, unknown> | undefined;

beforeAll(async () => {
  try {
    const { rows } = await db().query("select * from pronunciation_lexicon where id");
    snapshot = rows[0];
  } catch (error) {
    throw new Error(
      "dictionary.test.ts needs a migrated database. Run:\n" +
        '  docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"\n' +
        `original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

afterEach(async () => {
  if (!snapshot) {
    await db().query(`delete from "pronunciation_lexicon" where "id"`);
    return;
  }
  await db().query(
    `insert into "pronunciation_lexicon"
       ("id", "entries", "dictionaryId", "versionId", "syncedAt", "updatedAt", "updatedBy")
     values (true, $1, $2, $3, $4, $5, $6)
     on conflict ("id") do update set
       "entries"      = excluded."entries",
       "dictionaryId" = excluded."dictionaryId",
       "versionId"    = excluded."versionId",
       "syncedAt"     = excluded."syncedAt",
       "updatedAt"    = excluded."updatedAt",
       "updatedBy"    = excluded."updatedBy"`,
    [
      JSON.stringify(snapshot.entries),
      snapshot.dictionaryId ?? null,
      snapshot.versionId ?? null,
      snapshot.syncedAt ?? null,
      snapshot.updatedAt,
      snapshot.updatedBy ?? null,
    ],
  );
});

afterAll(closeDb);

describe("readLexicon", () => {
  /** Migration 0008 puts the lexicon there; nothing in the app writes it on first read. */
  it("reads the seeded row", async () => {
    const lexicon = await readLexicon();
    expect(lexicon.seeded).toBe(true);
    expect(lexicon.entries.length).toBeGreaterThan(0);
  });

  /**
   * Seeded is not uploaded. Reporting it as synced would claim audio is being generated with
   * rules that have never reached ElevenLabs.
   */
  it("does not claim a seeded lexicon is in force at ElevenLabs", async () => {
    await db().query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "id"`,
    );
    expect((await readLexicon()).sync).toBe("never");
    expect(await currentLocator()).toBeNull();
  });

  /**
   * Only reachable with migrations unrun. Worth reporting rather than rendering as an empty
   * lexicon: no rows is exactly what a failed deploy looked like, and the page should say so
   * instead of inviting someone to retype 134 entries.
   */
  it("reports an unseeded table rather than an empty lexicon", async () => {
    await db().query(`delete from "pronunciation_lexicon" where "id"`);
    const lexicon = await readLexicon();
    expect(lexicon.seeded).toBe(false);
    expect(lexicon.entries).toEqual([]);
  });
});

describe("writeLexicon", () => {
  it("stores the entries and the locator the upload produced", async () => {
    const { fetchImpl } = accepts();
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toBeNull();
    expect(lexicon.seeded).toBe(true);
    expect(lexicon.sync).toBe("synced");
    expect(lexicon.entries).toEqual(ENTRIES);
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
    expect(await currentLocator()).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
  });

  it("sends case-insensitive phoneme rules", async () => {
    const { fetchImpl, calls } = accepts();
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(fetchImpl));

    const [url, init] = calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/pronunciation-dictionaries/add-from-rules");
    expect(JSON.parse(String(init.body)).rules).toEqual([
      {
        string_to_replace: "Gnomeregan",
        type: "phoneme",
        phoneme: "ˈnoʊmɹəɡæn",
        alphabet: "ipa",
        case_sensitive: false,
        word_boundaries: true,
      },
    ]);
  });

  /**
   * The save is the part that must not be lost. An edit that reached Postgres and not
   * ElevenLabs is retryable from the editor; the reverse would leave ElevenLabs holding
   * rules that no row describes, and generation applying pronunciations nothing can show.
   */
  it("keeps the entries when the upload fails, and says why", async () => {
    await db().query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "id"`,
    );
    const { fetchImpl } = refuses();
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toMatch(/quota exceeded/);
    expect(lexicon.entries).toEqual(ENTRIES);
    // `never`, not `pending`: with no locator there is no older dictionary for this save to
    // be queued behind, and nothing is being applied to a request at all. syncError is what
    // carries "the upload you just asked for failed"; the state carries what is in force.
    expect(lexicon.sync).toBe("never");
    expect(lexicon.locator).toBeNull();
  });

  /**
   * The case the editor exists to make visible. A second save whose upload fails leaves the
   * FIRST dictionary in force, so the page is showing entries that lines are not being
   * spoken with - and generation must keep using the locator it has rather than none.
   */
  it("reports a failed re-upload as pending while the previous dictionary stays in force", async () => {
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(accepts().fetchImpl));

    const edited = [{ ...ENTRIES[0], ipa: "ɡnoʊmˈɹɛɡən" }];
    const { lexicon } = await writeLexicon(edited, null as unknown as string,
      OPTIONS(refuses().fetchImpl));

    expect(lexicon.sync).toBe("pending");
    expect(lexicon.entries).toEqual(edited);
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
    expect(await currentLocator()).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
  });
});

describe("concurrent saves", () => {
  /**
   * Two admins at once: save(A), save(B), then A's upload lands last. Without the condition
   * on the update, the row would pair B's entries with A's rules and report itself synced,
   * because syncedAt would be newer than updatedAt - the editor showing pronunciations that
   * nothing is being spoken with.
   */
  it("refuses to attach a locator to entries it did not upload", async () => {
    await db().query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "id"`,
    );
    const a = [{ ...ENTRIES[0], ipa: "aaa" }];
    const b = [{ ...ENTRIES[0], ipa: "bbb" }];

    await writeLexicon(a, null as unknown as string, OPTIONS(refuses().fetchImpl));
    await writeLexicon(b, null as unknown as string, OPTIONS(refuses().fetchImpl));

    // A's upload finally succeeds, but B is what is stored now.
    const error = await sync(a, OPTIONS(accepts("dict-a", "ver-a").fetchImpl));

    expect(error).toMatch(/changed while this upload was in flight/);
    const lexicon = await readLexicon();
    expect(lexicon.entries).toEqual(b);
    // Neither upload landed a locator, so nothing is in force - see the note above about
    // never vs pending.
    expect(lexicon.sync).toBe("never");
    expect(await currentLocator()).toBeNull();
  });
});

describe("resync", () => {
  it("uploads what is stored and puts it in force", async () => {
    await db().query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "id"`,
    );
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(refuses().fetchImpl));
    expect((await readLexicon()).sync).toBe("never");

    const error = await resync(OPTIONS(accepts("dict-xyz", "ver-9").fetchImpl));

    expect(error).toBeNull();
    const lexicon = await readLexicon();
    expect(lexicon.sync).toBe("synced");
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-xyz", versionId: "ver-9" });
  });

  // Only reachable with migrations unrun, since 0008 seeds the row - but resync must still
  // say so rather than uploading an empty dictionary and reporting success.
  it("refuses when there is no lexicon at all", async () => {
    await db().query(`delete from "pronunciation_lexicon" where "id"`);
    expect(await resync(OPTIONS(accepts().fetchImpl))).toMatch(/no saved lexicon/);
  });
});

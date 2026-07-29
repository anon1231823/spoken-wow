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
const { currentLocator, readLexicon, resetLexicon, resync, sync, writeLexicon } = await import(
  "./dictionary"
);

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

beforeAll(async () => {
  try {
    await db().query("select 1 from pronunciation_lexicon limit 1");
  } catch (error) {
    throw new Error(
      "dictionary.test.ts needs a migrated database. Run:\n" +
        '  docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"\n' +
        `original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

// The table holds one row forever, so a test that leaves one behind is a test that changes
// what the next one reads - including in other files, which share this database.
afterEach(resetLexicon);
afterAll(closeDb);

describe("readLexicon", () => {
  it("reports the committed file when nothing has been saved", async () => {
    const lexicon = await readLexicon();
    expect(lexicon.source).toBe("file");
    expect(lexicon.entries).toEqual(lexicon.defaults);
    expect(lexicon.entries.length).toBeGreaterThan(0);
  });

  /**
   * "file" and "never" together, which is the honest description of a fresh install: these
   * are the intended pronunciations and none of them are reaching ElevenLabs. Reporting it
   * as synced would claim audio is being generated with rules that have never been uploaded.
   */
  it("does not claim the committed file is in force at ElevenLabs", async () => {
    expect((await readLexicon()).sync).toBe("never");
    expect(await currentLocator()).toBeNull();
  });
});

describe("writeLexicon", () => {
  it("stores the entries and the locator the upload produced", async () => {
    const { fetchImpl } = accepts();
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toBeNull();
    expect(lexicon.source).toBe("database");
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
    const { fetchImpl } = refuses();
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toMatch(/quota exceeded/);
    expect(lexicon.entries).toEqual(ENTRIES);
    expect(lexicon.source).toBe("database");
    expect(lexicon.sync).toBe("pending");
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
    const a = [{ ...ENTRIES[0], ipa: "aaa" }];
    const b = [{ ...ENTRIES[0], ipa: "bbb" }];

    await writeLexicon(a, null as unknown as string, OPTIONS(refuses().fetchImpl));
    await writeLexicon(b, null as unknown as string, OPTIONS(refuses().fetchImpl));

    // A's upload finally succeeds, but B is what is stored now.
    const error = await sync(a, OPTIONS(accepts("dict-a", "ver-a").fetchImpl));

    expect(error).toMatch(/changed while this upload was in flight/);
    const lexicon = await readLexicon();
    expect(lexicon.entries).toEqual(b);
    expect(lexicon.sync).toBe("pending");
    expect(await currentLocator()).toBeNull();
  });
});

describe("resync", () => {
  it("uploads what is stored and clears the pending state", async () => {
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(refuses().fetchImpl));
    expect((await readLexicon()).sync).toBe("pending");

    const error = await resync(OPTIONS(accepts("dict-xyz", "ver-9").fetchImpl));

    expect(error).toBeNull();
    const lexicon = await readLexicon();
    expect(lexicon.sync).toBe("synced");
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-xyz", versionId: "ver-9" });
  });

  it("refuses when there is nothing saved to upload", async () => {
    expect(await resync(OPTIONS(accepts().fetchImpl))).toMatch(/no saved lexicon/);
  });
});

describe("resetLexicon", () => {
  /**
   * The locator goes with the row, so generation stops applying any dictionary. That is the
   * correct reading of "reset": the committed file has never been uploaded by anyone, so
   * leaving the last upload attached would apply rules nobody can see on the page.
   */
  it("drops the override and the dictionary with it", async () => {
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(accepts().fetchImpl));
    await resetLexicon();

    const lexicon = await readLexicon();
    expect(lexicon.source).toBe("file");
    expect(lexicon.sync).toBe("never");
    expect(await currentLocator()).toBeNull();
  });
});

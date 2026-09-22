/**
 * Against a real Postgres, for the reason history.test.ts gives: the invariant worth
 * pinning belongs to the schema. `book_line_current_idx` allows exactly one live version
 * per page, and a save is two statements that must not half-apply -- between them the page
 * would have no current version at all, and the export ships nothing for it.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { BookConflict, bookHistory, restoreBookText, saveBookText } = await import("./text");

/** A page id no other run will collide with, so this can share a database. */
let lineId: string;

async function seed(text: string, skipReason: string | null = null) {
  await db().query(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
        "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material", "text",
        "generatable", "skipReason")
     values ($1, 'enUS', 1, true, 'extracted', 1, 1, 1, 1, 'A Test Tome', 'item',
             '{1}'::integer[], 0, $2, $3::text is null, $3)`,
    [lineId, text, skipReason],
  );
}

async function voiceable(lang: string) {
  const { rows } = await db().query<{ generatable: boolean; skipReason: string | null }>(
    `select "generatable", "skipReason" from "book_line"
      where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
    [lineId, lang],
  );
  return rows[0];
}

beforeEach(() => {
  lineId = `b:test-${Math.random().toString(16).slice(2)}`;
});

afterEach(async () => {
  await db().query(`delete from "book_line" where "lineId" = $1`, [lineId]);
});

afterAll(async () => {
  await closeDb();
});

describe("rewriting a page", () => {
  it("adds a version and leaves exactly one live", async () => {
    await seed("The orignal text.");

    const saved = await saveBookText({
      lineId,
      text: "The original text.",
      editedBy: "someone",
      expectedVersion: 1,
    });

    expect(saved).toMatchObject({ version: 2, isCurrent: true, origin: "edited" });
    const history = await bookHistory(lineId);
    expect(history.map((v) => v.version)).toEqual([2, 1]);
    expect(history.filter((v) => v.isCurrent)).toHaveLength(1);
  });

  it("carries the structural fields, which are the extract's and not an editor's", async () => {
    // Which book a page belongs to and what opens it are facts about the dump. An API that
    // let a text edit move them would be one bad request from a page the addon cannot find.
    await seed("Before.");
    await saveBookText({ lineId, text: "After.", editedBy: "someone" });

    const { rows } = await db().query<{ title: string; pageCount: number }>(
      `select "title", "pageCount" from "book_line" where "lineId" = $1 and "isCurrent"`,
      [lineId],
    );
    expect(rows[0]).toMatchObject({ title: "A Test Tome", pageCount: 1 });
  });

  it("spends no version on a save that changes nothing", async () => {
    // The history is a record of what the page has said, not of who opened the dialog.
    await seed("Unchanged.");
    await saveBookText({ lineId, text: "Unchanged.", editedBy: "someone" });

    expect(await bookHistory(lineId)).toHaveLength(1);
  });

  it("refuses an edit that started from a version somebody has since replaced", async () => {
    await seed("First.");
    await saveBookText({ lineId, text: "Second.", editedBy: "a" });

    // Still holding v1, as a dialog opened before the other save would be.
    await expect(
      saveBookText({ lineId, text: "Third.", editedBy: "b", expectedVersion: 1 }),
    ).rejects.toThrow(BookConflict);

    const live = (await bookHistory(lineId)).find((v) => v.isCurrent);
    expect(live?.text).toBe("Second.");
  });

  it("refuses empty text rather than shipping a silent page", async () => {
    await seed("Something.");
    await expect(saveBookText({ lineId, text: "   ", editedBy: "a" })).rejects.toThrow(/empty/);
  });
});

describe("whether a page can be voiced", () => {
  it("is decided per language, from that language's own text", async () => {
    await seed("Greetings, $N.", "substitution");

    await saveBookText({ lineId, text: "Saudações, viajante.", editedBy: "a", lang: "ptBR" });
    expect(await voiceable("ptBR")).toEqual({ generatable: true, skipReason: null });
    // The English keeps its token, and stays blocked.
    expect(await voiceable("enUS")).toEqual({ generatable: false, skipReason: "substitution" });

    await saveBookText({ lineId, text: "Saudações, $N.", editedBy: "a", lang: "ptBR" });
    expect(await voiceable("ptBR")).toEqual({ generatable: false, skipReason: "substitution" });
  });

  it("unblocks an English page once its edit removes the token", async () => {
    await seed("Greetings, $N.", "substitution");

    await saveBookText({ lineId, text: "Greetings, traveller.", editedBy: "a" });

    expect(await voiceable("enUS")).toEqual({ generatable: true, skipReason: null });
  });
});

describe("putting an earlier version back", () => {
  it("moves the live flag rather than writing another version", async () => {
    // The same thing restore means for a lore version and for a take: a statement about
    // which of these texts is right, not a new one.
    await seed("First.");
    await saveBookText({ lineId, text: "Second.", editedBy: "a" });

    await restoreBookText(lineId, 1);

    const history = await bookHistory(lineId);
    expect(history).toHaveLength(2);
    expect(history.find((v) => v.isCurrent)).toMatchObject({ version: 1, text: "First." });
  });
});

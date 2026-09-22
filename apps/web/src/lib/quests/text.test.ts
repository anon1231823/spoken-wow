/**
 * Writing another language's quest text and names. Against a real Postgres with the corpus
 * imported, because the structure a first translation copies is a row that has to exist.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const { closeDb, db, query } = await import("@/lib/db");
const { questTextHistory, restoreQuestText, saveQuestText, QuestTextConflict } = await import("./text");
const { saveName, nameHistory } = await import("@/lib/names/store");
const { clearIgnore, readIgnores, writeIgnore, IgnoreConflict } = await import("./ignores");

const LANG = "itIT";
let english: { lineId: string; variant: number; questId: number; fileName: string; source: string };
let userId: string;

beforeAll(async () => {
  const rows = await query<typeof english>(
    `select "lineId", "variant", "questId", "fileName", "source" from "quest_line"
      where "lang" = 'enUS' and "isCurrent" and "questId" is not null and "source" = 'accept'
      order by "lineId" limit 1`,
  );
  if (!rows[0]) throw new Error("text.test.ts needs the corpus imported");
  english = rows[0];
  userId = `test-${Math.random().toString(36).slice(2, 10)}`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Translator', $1 || '@test', false, now(), now())`,
    [userId],
  );
});

afterEach(async () => {
  await db().query(`delete from "quest_line" where "lang" = $1`, [LANG]);
  await db().query(`delete from "entity_name" where "lang" = $1`, [LANG]);
  await db().query(`delete from "line_ignore" where "lineId" = $1`, ["q:0:ignore-test"]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [userId]);
  await closeDb();
});

describe("a first translation", () => {
  it("takes its structure from the English line and is live", async () => {
    const saved = await saveQuestText({
      lineId: english.lineId,
      variant: english.variant,
      lang: LANG,
      text: "Salve, viandante.",
      editedBy: userId,
    });
    expect(saved).toMatchObject({ version: 1, isCurrent: true, origin: "edited" });

    const rows = await query<{ fileName: string; source: string; generatable: boolean }>(
      `select "fileName", "source", "generatable" from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [english.lineId, english.variant, LANG],
    );
    expect(rows[0]).toEqual({ fileName: english.fileName, source: english.source, generatable: true });
  });

  it("is not voiceable while it still holds a player-name token", async () => {
    await saveQuestText({
      lineId: english.lineId,
      variant: english.variant,
      lang: LANG,
      text: "Grazie, $N.",
      editedBy: userId,
    });
    const rows = await query<{ generatable: boolean; skipReason: string | null }>(
      `select "generatable", "skipReason" from "quest_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [english.lineId, LANG],
    );
    expect(rows[0]).toEqual({ generatable: false, skipReason: "invalid-chars" });
  });
});

describe("a later translation", () => {
  it("is refused when somebody else saved in between", async () => {
    const base = { lineId: english.lineId, variant: english.variant, lang: LANG as "itIT", editedBy: userId };
    await saveQuestText({ ...base, text: "Uno." });
    await saveQuestText({ ...base, text: "Due.", expectedVersion: 1 });
    await expect(saveQuestText({ ...base, text: "Tre.", expectedVersion: 1 })).rejects.toBeInstanceOf(
      QuestTextConflict,
    );
  });

  it("can be put back", async () => {
    const base = { lineId: english.lineId, variant: english.variant, lang: LANG as "itIT", editedBy: userId };
    await saveQuestText({ ...base, text: "Uno." });
    await saveQuestText({ ...base, text: "Due." });
    await restoreQuestText(english.lineId, english.variant, LANG, 1);
    const history = await questTextHistory(english.lineId, english.variant, LANG);
    expect(history.find((v) => v.isCurrent)?.text).toBe("Uno.");
  });

  it("is never English, which is rewritten through line_override", async () => {
    await expect(
      saveQuestText({ lineId: english.lineId, variant: english.variant, lang: "enUS", text: "x", editedBy: userId }),
    ).rejects.toThrow(/line_override/);
  });
});

describe("naming", () => {
  it("names a thing English has a name for, and refuses one it has not", async () => {
    await saveName({ kind: "quest", entityId: String(english.questId), lang: LANG, name: "Titolo", editedBy: userId });
    expect((await nameHistory("quest", String(english.questId), LANG))[0]).toMatchObject({
      name: "Titolo",
      origin: "edited",
      isCurrent: true,
    });
    await expect(
      saveName({ kind: "quest", entityId: "999999999", lang: LANG, name: "x", editedBy: userId }),
    ).rejects.toThrow(/no English name/);
  });
});

describe("ignores at two levels", () => {
  it("counts a line ignored in one language only there", async () => {
    await writeIgnore("q:0:ignore-test", "the Italian never says this", userId, LANG);
    expect((await readIgnores(LANG)).get("q:0:ignore-test")?.lang).toBe(LANG);
    expect((await readIgnores("enUS")).has("q:0:ignore-test")).toBe(false);
    expect(await clearIgnore("q:0:ignore-test", LANG)).toBe(true);
  });

  it("counts a line ignored everywhere in every language", async () => {
    await writeIgnore("q:0:ignore-test", "nobody voices this", userId);
    expect((await readIgnores(LANG)).get("q:0:ignore-test")?.lang).toBeNull();
    expect((await readIgnores("enUS")).has("q:0:ignore-test")).toBe(true);
  });

  // Until 0037's successor drops line_ignore's old primary key, one row per line.
  it("says so when the line is already ignored at the other level", async () => {
    await writeIgnore("q:0:ignore-test", "nobody voices this", userId);
    await expect(writeIgnore("q:0:ignore-test", "nor Italian", userId, LANG)).rejects.toBeInstanceOf(
      IgnoreConflict,
    );
  });
});

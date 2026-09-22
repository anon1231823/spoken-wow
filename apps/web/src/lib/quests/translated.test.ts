/**
 * Another language's quest lines, read over the English ones. Against a real Postgres with
 * the corpus imported, because what is being tested is a join and the rows it joins.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web" && make quests-import-corpus
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { CorpusLine } from "@/lib/corpus";

const { closeDb, db, query } = await import("@/lib/db");
const { corpus } = await import("./catalogue");

// A language nothing else in the suite writes, so these rows cannot meet another test's.
const LANG = "itIT";

type Line = {
  lineId: string;
  variant: number;
  questId: number;
  questTitle: string;
  text: string;
  npcType: string;
  npcId: number;
  npcName: string;
};
let line: Line;

beforeAll(async () => {
  const rows = await query<Line>(
    `select l."lineId", l."variant", l."questId", l."questTitle", l."text",
            s."npcType", s."npcId", s."npcName"
       from "quest_line" l
       join "quest_line_speaker" s
         on s."lineId" = l."lineId" and s."variant" = l."variant" and s."lang" = l."lang"
      where l."lang" = 'enUS' and l."isCurrent" and l."questId" is not null and l."generatable"
      order by l."lineId" limit 1`,
  );
  if (!rows[0]) throw new Error("translated.test.ts needs the corpus imported: make quests-import-corpus");
  line = rows[0];
});

afterEach(async () => {
  await db().query(`delete from "quest_line" where "lang" = $1`, [LANG]);
  await db().query(`delete from "entity_name" where "lang" = $1`, [LANG]);
});

afterAll(closeDb);

async function translate(text: string) {
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "questTitle", "fileName", "text", "originalText", "generatable")
     select "lineId", "variant", $2, 1, true, 'extracted', "source", "questId",
            "questTitle", "fileName", $3, "originalText", true
       from "quest_line"
      where "lineId" = $1 and "variant" = $4 and "lang" = 'enUS' and "isCurrent"`,
    [line.lineId, LANG, text, line.variant],
  );
}

async function name(kind: string, entityId: string | number, value: string) {
  await db().query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ($1, $2, $3, 1, true, 'extracted', $4)`,
    [kind, String(entityId), LANG, value],
  );
}

function rowOf(lines: CorpusLine[]): CorpusLine {
  return lines.find((candidate) => candidate.lineId === line.lineId)!;
}

describe("a language read over the English lines", () => {
  it("has every English line, and says which it has not translated", async () => {
    const [english, italian] = await Promise.all([corpus(), corpus(LANG)]);
    expect(italian.lines).toHaveLength(english.lines.length);

    const row = rowOf(italian.lines);
    expect(row.text).toBe(line.text);
    expect(row.missing).toEqual({ text: true, questTitle: true, npcName: true });
    // The English is there to be read, never to be recorded under the language's name.
    expect(row.generatable).toBe(false);
    expect(row.skipReason).toBe("untranslated");
  });

  it("takes the language's own text and names where it has them", async () => {
    await translate("Salve, viandante.");
    await name("quest", line.questId, "Il titolo");

    const row = rowOf((await corpus(LANG)).lines);
    expect(row.text).toBe("Salve, viandante.");
    expect(row.questTitle).toBe("Il titolo");
    expect(row.npcName).toBe(line.npcName);
    expect(row.missing).toEqual({ text: false, questTitle: false, npcName: true });
    expect(row.generatable).toBe(true);
  });

  it("leaves English exactly as it reads without any of this", async () => {
    await translate("Salve, viandante.");
    const row = rowOf((await corpus()).lines);
    expect(row.text).toBe(line.text);
    expect(row.missing).toBeUndefined();
  });
});

describe("English names in entity_name", () => {
  // The columns stay English's source, and a trigger copies each write across: see 0036.
  it("holds every quest's title and every speaker's name", async () => {
    const rows = await query<{ kind: string; name: string }>(
      `select "kind", "name" from "entity_name"
        where "lang" = 'enUS' and "isCurrent"
          and (("kind" = 'quest' and "entityId" = $1) or ("kind" = $2 and "entityId" = $3))`,
      [String(line.questId), line.npcType, String(line.npcId)],
    );
    expect(rows.map((row) => row.kind).sort()).toEqual(["quest", line.npcType].sort());
  });
});

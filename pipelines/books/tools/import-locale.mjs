// vmangos locales_page_text and the owners' localised names -> book_line and entity_name,
// for one language.
//
//   node tools/import-locale.mjs --lang deDE
//
// Straight into Postgres, with no file between: English goes through corpus/extract.json
// because the committed Lua is exported from it, and nothing is built from a translation
// yet. The rules are import.mjs's -- unchanged text is skipped, changed text is promoted
// unless somebody edited the page here, in which case the dump's text is recorded but not
// made live -- and a page is written only where the English corpus has one.

import mysql from "mysql2/promise";
import pg from "pg";

import { loadEnv, MYSQL_VARS } from "../../lib/env.mjs";
import { localeInfo, BASE_LOCALE } from "../../lib/locales.mjs";
import { localizedPages, localizedTitles } from "./lib/locale.mjs";
import { decideImport } from "./lib/promote.mjs";

await loadEnv("books", { override: MYSQL_VARS });

const lang = process.argv[process.argv.indexOf("--lang") + 1];
const info = process.argv.includes("--lang") ? localeInfo(lang) : null;
if (!info || lang === BASE_LOCALE) {
  throw new Error("usage: import-locale.mjs --lang <code>, a language other than English");
}
if (info.vmangos === null) {
  throw new Error(`${lang} has no columns in the world database; its pages are written on the site`);
}
const N = info.vmangos;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set -- the books corpus lives in Postgres");
const pool = new pg.Pool({ connectionString: url });

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "wow",
  database: process.env.MYSQL_DATABASE ?? "mangos",
});

const counts = { promote: 0, record: 0, skip: 0, names: 0 };

/** One transaction for a batch of writes: an import that fails leaves nothing half-applied. */
async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await work(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const { rows: english } = await pool.query(
    `select "lineId", "pageId", "bookId", "pageNumber", "pageCount", "title", "ownerKind",
            "ownerIds", "material"
       from "book_line" where "lang" = $1 and "isCurrent"`,
    [BASE_LOCALE],
  );
  if (english.length === 0) throw new Error("book_line holds no English pages; run make books-import first");
  const structure = new Map(english.map((row) => [row.lineId, row]));

  const [pageRows] = await connection.query(
    `SELECT entry, Text_loc${N} AS text FROM locales_page_text`,
  );
  const { pages, withoutEnglish } = localizedPages(pageRows, new Set(structure.keys()));

  // What is live, read once and decided in memory, then written in one transaction: a
  // re-run that changes nothing is one query, not one per page.
  const { rows: livePages } = await pool.query(
    `select "lineId", "origin", "text" from "book_line" where "lang" = $1 and "isCurrent"`,
    [lang],
  );
  const current = new Map(livePages.map((row) => [row.lineId, row]));
  const writes = [];
  for (const page of pages) {
    const { action } = decideImport(current.get(page.lineId) ?? null, page);
    counts[action]++;
    if (action !== "skip") writes.push({ page, promote: action === "promote" });
  }

  await inTransaction(async (client) => {
    for (const { page, promote } of writes) {
      const base = structure.get(page.lineId);
      if (promote) {
        await client.query(
          `update "book_line" set "isCurrent" = false
            where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
          [page.lineId, lang],
        );
      }
      // Structure is the English row's: where a page sits is a fact about the world, not a
      // translation. The title column is required and carries the English; the language's
      // own title for the owner lives in entity_name.
      await client.query(
        `insert into "book_line"
           ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
            "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
            "text", "generatable", "skipReason")
         select $1, $2, coalesce(max("version"), 0) + 1, $3, 'extracted', $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14
           from "book_line" where "lineId" = $1 and "lang" = $2`,
        [
          page.lineId, lang, promote,
          base.pageId, base.bookId, base.pageNumber, base.pageCount, base.title,
          base.ownerKind, base.ownerIds, base.material,
          page.text, page.generatable, page.skipReason,
        ],
      );
    }
  });

  // The owners the English corpus names, and nothing else: the dump localises every item.
  const owners = { object: new Set(), item: new Set() };
  for (const row of english) for (const id of row.ownerIds) owners[row.ownerKind].add(id);
  const ownerRows = [];
  for (const [kind, table] of [["object", "locales_gameobject"], ["item", "locales_item"]]) {
    if (owners[kind].size === 0) continue;
    const [rows] = await connection.query(
      `SELECT entry AS id, name_loc${N} AS name FROM ${table} WHERE entry IN (?)`,
      [[...owners[kind]]],
    );
    ownerRows.push(...rows.map((row) => ({ kind, ...row })));
  }

  const { rows: liveNames } = await pool.query(
    `select "kind", "entityId", "origin", "name" as "text" from "entity_name"
      where "lang" = $1 and "kind" in ('item', 'gameobject') and "isCurrent"`,
    [lang],
  );
  const currentNames = new Map(liveNames.map((row) => [`${row.kind}:${row.entityId}`, row]));
  const nameWrites = [];
  for (const title of localizedTitles(ownerRows)) {
    const { action } = decideImport(currentNames.get(`${title.kind}:${title.entityId}`) ?? null, {
      text: title.name,
    });
    if (action !== "skip") nameWrites.push({ title, promote: action === "promote" });
  }
  counts.names = nameWrites.length;

  await inTransaction(async (client) => {
    for (const { title, promote } of nameWrites) {
      if (promote) {
        await client.query(
          `update "entity_name" set "isCurrent" = false
            where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
          [title.kind, title.entityId, lang],
        );
      }
      await client.query(
        `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
         select $1, $2, $3, coalesce(max("version"), 0) + 1, $4, 'extracted', $5
           from "entity_name" where "kind" = $1 and "entityId" = $2 and "lang" = $3`,
        [title.kind, title.entityId, lang, promote, title.name],
      );
    }
  });

  console.log(
    `${lang}: ${counts.promote} pages promoted, ${counts.record} recorded, ${counts.skip} unchanged, ` +
      `${withoutEnglish} without an English page; ${counts.names} titles written`,
  );
} finally {
  await connection.end();
  await pool.end();
}

// vmangos -> corpus/extract.json.
//
// Writes a file rather than importing straight into Postgres, for the reason the quests
// pipeline splits the same way: the dump is only reachable from a machine running the
// Docker MySQL, the import is not, and a reviewable intermediate makes "did the extract
// change" answerable with a diff instead of a database query.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import mysql from "mysql2/promise";

import { readWorld, PATCH } from "./lib/world.mjs";
import { buildBooks } from "./lib/chains.mjs";

const OUT = new URL("../corpus/extract.json", import.meta.url).pathname;

// BOOKS_-PREFIXED, NOT MYSQL_. tts_cli/env_vars.py loads its .env with override=True and
// says why: generic names like MYSQL_PASSWORD are exported by other projects, and an
// ambient one turns "connect to the local vmangos" into an access-denied error that looks
// like the dump is missing. One such variable was already exported on the machine this was
// written on. The defaults are the quests pipeline's docker-compose values.
const connection = await mysql.createConnection({
  host: process.env.BOOKS_MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.BOOKS_MYSQL_PORT ?? 3306),
  user: process.env.BOOKS_MYSQL_USER ?? "root",
  password: process.env.BOOKS_MYSQL_PASSWORD ?? "wow",
  database: process.env.BOOKS_MYSQL_DATABASE ?? "mangos",
});

try {
  const world = await readWorld(connection, Number(process.env.BOOKS_PATCH ?? PATCH));
  const { entries, orphans, shared } = buildBooks(world);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({ entries, orphans, shared }, null, 2)}\n`);

  const books = new Set(entries.map((entry) => entry.bookId));
  const silent = entries.filter((entry) => !entry.generatable);
  console.log(
    `${entries.length} pages, ${books.size} books, ${orphans.length} orphaned pages, ` +
      `${shared.length} pages claimed by a second chain`,
  );
  console.log(`${silent.length} pages cannot be voiced: ${summarise(silent)}`);
  console.log(`wrote ${OUT}`);
} finally {
  await connection.end();
}

function summarise(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.skipReason, (counts.get(entry.skipReason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => `${count} ${reason}`).join(", ") || "none";
}

#!/usr/bin/env node
// One language's zone and subzone names -> entity_name.
//
//   node tools/lore/import-names.mjs --lang deDE
//
// From the addon's own alias table, Data/<lang>/Aliases.lua, which is built from the game's
// AreaTable: the names a client in that language actually shows. The lore prose has no
// such source -- nothing in the dump or the client carries it translated -- so it is
// written on the site, and this only names the places.
//
// The rule is every import's: an unchanged name is skipped, a changed one replaces an
// extracted name but never one somebody edited here.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { BASE_LOCALE, isLocale } from "../../../lib/locales.mjs";
import { loadEnvFile } from "../lib/env.mjs";
import { namesFromAliases, parseAliases } from "../lib/aliases.mjs";
import { ROOT } from "../lib/loredata.mjs";

await loadEnvFile();
const { close, isEnabled, query, transaction } = await import("../voice/db.mjs");

const lang = process.argv[process.argv.indexOf("--lang") + 1];
if (!process.argv.includes("--lang") || !isLocale(lang) || lang === BASE_LOCALE) {
  console.error("usage: import-names.mjs --lang <code>, a language other than English");
  process.exit(2);
}
if (!isEnabled()) {
  console.error("error: DATABASE_URL is not set, so there is nothing to import into.");
  process.exit(1);
}

const counts = { promote: 0, record: 0, skip: 0 };

try {
  const lua = await readFile(join(ROOT, "addons/SpokenZones/Data", lang, "Aliases.lua"), "utf8");
  const { rows: lines } = await query(
    `select "lineId", "kind", "key", "name" from "lore_line"
      where "lang" = $1 and "isCurrent"`,
    [BASE_LOCALE],
  );
  if (lines.length === 0) throw new Error("lore_line holds no English lines; run make zones-lore-import");

  for (const name of namesFromAliases(lines, parseAliases(lua))) {
    await transaction(async (client) => {
      const { rows } = await client.query(
        `select "origin", "name" from "entity_name"
          where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent" for update`,
        [name.kind, name.entityId, lang],
      );
      const current = rows[0];
      const action = !current
        ? "promote"
        : current.name === name.name
          ? "skip"
          : current.origin === "edited"
            ? "record"
            : "promote";
      counts[action]++;
      if (action === "skip") return;
      if (action === "promote") {
        await client.query(
          `update "entity_name" set "isCurrent" = false
            where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
          [name.kind, name.entityId, lang],
        );
      }
      await client.query(
        `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
         select $1, $2, $3, coalesce(max("version"), 0) + 1, $4, 'extracted', $5
           from "entity_name" where "kind" = $1 and "entityId" = $2 and "lang" = $3`,
        [name.kind, name.entityId, lang, action === "promote", name.name],
      );
    });
  }

  console.log(
    `${lang}: ${counts.promote} names written, ${counts.record} recorded under an edit, ` +
      `${counts.skip} unchanged`,
  );
} finally {
  await close();
}

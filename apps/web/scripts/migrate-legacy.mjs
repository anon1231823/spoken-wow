/**
 * Move the two old sites' data into the merged database. Runs once, at cutover.
 *
 *   DATABASE_URL=postgres://…/spoken \
 *   ZONELORE_URL=postgres://…/zonelore \
 *   node apps/web/scripts/migrate-legacy.mjs [--dry-run] [--lines]
 *
 * WHAT THIS DOES NOT DO: the quests half. That database is restored wholesale --
 * `pg_dump voiceover | psql spoken`, then the migrations -- because the merged schema was
 * grown from it: every table it has, this one has, and 0020 and 0021 copy its takes and
 * reports into their new homes as part of being applied. Reimplementing that here would be
 * a second description of the same thing, and the two would drift.
 *
 * So what is left is the zones half, laid over a database that already holds quests data.
 *
 * ONE TRANSACTION. A half-migrated cutover is the worst outcome available: the old sites
 * are stopped, the new one is not yet serving, and deciding what has already been copied
 * is a question nobody wants to answer under time pressure. Either all of it lands or none
 * of it does and the whole thing can be run again.
 *
 * RERUNNABLE, up to that transaction. It refuses to run twice rather than merging twice --
 * see the marker at the end -- because the tables it writes have no natural key to conflict
 * on: reports are deliberately never deduplicated, and takes are versioned per file.
 *
 * ACCOUNTS ARE MERGED BY EMAIL, keeping the quests row. Somebody who worked on both sites
 * has two accounts, one password each, and the quests one is the one whose id is already
 * attached to take history, voice clones, settings and lexicon edits in this database. The
 * zones id is remapped to it everywhere it appears.
 */
import { createHash } from "node:crypto";

import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Copy what the zones site knows about LINES, and nothing it knows about PEOPLE.
 *
 * The split is which rows can be thrown away and written again. A lore row, a flag and a
 * take are all statements about a zone line that lore.rusty.one holds the only copy of:
 * re-copying them replaces them with themselves, so this mode deletes and re-imports each
 * of the three wholesale and can be run as often as it is useful. Accounts, sealed keys
 * and reports cannot be treated that way -- accounts are merged into rows this database
 * already has, and reports are deliberately never deduplicated -- so they move exactly
 * once, at the cutover.
 *
 * What it is for: a staged site that can be looked at. Without the corpus /zones says the
 * lore is not loaded; without the takes it says every line is missing audio, because
 * presence is read from the take table while the files themselves sit on disk.
 *
 * Which is also why this mode writes no marker: it is not the import, it does not stand in
 * for it, and the real one must still refuse to run twice afterwards.
 */
const LINES_ONLY = process.argv.includes("--lines");

const TARGET = process.env.DATABASE_URL;
const SOURCE = process.env.ZONELORE_URL;

if (!TARGET || !SOURCE) {
  console.error(
    "usage: DATABASE_URL=… ZONELORE_URL=… node apps/web/scripts/migrate-legacy.mjs [--dry-run]",
  );
  process.exit(1);
}
if (TARGET === SOURCE) {
  console.error("migrate-legacy: DATABASE_URL and ZONELORE_URL are the same database");
  process.exit(1);
}

/**
 * The zones vocabulary, mapped onto the merged one.
 *
 * 'lore' and 'audio' are this project's names for complaints the quests side already had
 * under other names; mapping them at import rather than keeping both spellings is what
 * lets the triage page have one filter instead of one per source.
 */
const CATEGORY = {
  lore: "wrong_text",
  audio: "audio_quality",
  pronunciation: "pronunciation",
  other: "other",
};

/** Manifest field -> merged column, as store.mjs maps them. Kept in step by hand. */
const TAKE_COLUMNS = [
  ["file", "file"],
  ["textHash", "spokenHash"],
  ["chars", "characters"],
  ["credits", "credits"],
  ["durationSec", "durationSec"],
  ["bytes", "bytes"],
  ["voiceId", "voiceId"],
  ["modelId", "modelId"],
  ["outputFormat", "outputFormat"],
  ["dictionaryId", "dictionaryId"],
  ["dictionaryVersionId", "dictionaryVersion"],
];

async function main() {
  const source = new pg.Client({ connectionString: SOURCE });
  const target = new pg.Client({ connectionString: TARGET });
  await source.connect();
  await target.connect();

  try {
    const already = await target.query(
      `select 1 from "schema_migrations" where "name" = $1`,
      ["legacy-zones-import"],
    );
    if (already.rowCount && !LINES_ONLY) {
      throw new Error(
        "the zones data has already been imported into this database. Restore it from the " +
          "pg_dump and start again if you need to re-run.",
      );
    }

    await target.query("begin");

    if (LINES_ONLY) {
      const lore = await copyLore(source, target);
      const flags = await copyFlags(source, target);
      const takes = await copyTakes(source, target);
      console.log("");
      console.log(`  lore_line  ${lore.rows} rows across ${lore.langs} languages` +
        (lore.replaced ? `, replacing ${lore.replaced}` : ""));
      console.log(`  line_flag  ${flags.rows} verdicts` +
        (flags.replaced ? `, replacing ${flags.replaced}` : ""));
      console.log(`  take       ${takes.rows} zone takes` +
        (takes.replaced ? `, replacing ${takes.replaced}` : ""));
      console.log("");
      if (DRY_RUN) {
        await target.query("rollback");
        console.log("dry run: rolled back, nothing was written");
      } else {
        await target.query("commit");
        console.log("committed. Lines only -- accounts, keys and reports still move at the cutover.");
      }
      return;
    }

    const users = await mergeUsers(source, target);
    const keys = await copyKeys(source, target, users);
    const lore = await copyLore(source, target);
    const flags = await copyFlags(source, target);
    const takes = await copyTakes(source, target);
    const reports = await copyReports(source, target, users);

    // A row in the ledger the migrations use, so a second run is refused rather than
    // doubling everything. Named like a migration because it is one in every sense that
    // matters here: a one-way change to this database's contents.
    await target.query(
      `insert into "schema_migrations" ("name") values ($1)`,
      ["legacy-zones-import"],
    );

    console.log("");
    console.log(`  users      ${users.matched} matched by email, ${users.created} created`);
    console.log(`  keys       ${keys} sealed ElevenLabs credentials`);
    console.log(`  lore_line  ${lore.rows} rows across ${lore.langs} languages`);
    console.log(`  line_flag  ${flags.rows} verdicts`);
    console.log(`  take       ${takes.rows} zone takes`);
    console.log(`  report     ${reports} reports`);
    console.log("");

    if (DRY_RUN) {
      await target.query("rollback");
      console.log("dry run: rolled back, nothing was written");
    } else {
      await target.query("commit");
      console.log("committed");
    }
  } catch (error) {
    await target.query("rollback").catch(() => {});
    throw error;
  } finally {
    await source.end();
    await target.end();
  }
}

/**
 * Match the two account tables by email, and carry over the ones that are new.
 *
 * The password comes with the account, because both sites ran the same Better Auth against
 * the same hashing: an account that moves here keeps the password its owner already knows.
 * Sessions deliberately do not move -- everybody signs in again, once, against a site whose
 * origin has changed anyway.
 *
 * `editor` becomes `collaborator`: same person, same powers, different word.
 */
async function mergeUsers(source, target) {
  const ROLE = { editor: "collaborator", admin: "admin", member: "member" };

  const { rows: theirs } = await source.query(
    `select "id", "name", "email", "emailVerified", "image", "role", "createdAt", "updatedAt"
       from "user"`,
  );
  const { rows: ours } = await target.query(`select "id", "email" from "user"`);
  const byEmail = new Map(ours.map((row) => [row.email.toLowerCase(), row.id]));

  const map = new Map();
  let matched = 0;
  let created = 0;

  for (const user of theirs) {
    const existing = byEmail.get(user.email.toLowerCase());
    if (existing) {
      map.set(user.id, existing);
      matched += 1;
      continue;
    }

    // A fresh id rather than theirs: the two tables were generated independently and
    // nothing guarantees they never collided. Derived from the email so a re-run after a
    // restore produces the same id for the same person.
    const id = `z${createHash("sha256").update(user.email.toLowerCase()).digest("hex").slice(0, 23)}`;
    await target.query(
      `insert into "user" ("id", "name", "email", "emailVerified", "image", "role",
                           "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        user.name,
        user.email,
        user.emailVerified,
        user.image,
        ROLE[user.role] ?? "member",
        user.createdAt,
        user.updatedAt,
      ],
    );

    // The credential rows, or the account exists and cannot be signed in to.
    const { rows: accounts } = await source.query(
      `select "accountId", "providerId", "accessToken", "refreshToken", "idToken",
              "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password",
              "createdAt", "updatedAt"
         from "account" where "userId" = $1`,
      [user.id],
    );
    for (const account of accounts) {
      await target.query(
        `insert into "account" ("id", "accountId", "providerId", "userId", "accessToken",
                                "refreshToken", "idToken", "accessTokenExpiresAt",
                                "refreshTokenExpiresAt", "scope", "password",
                                "createdAt", "updatedAt")
         values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          account.accountId === user.id ? id : account.accountId,
          account.providerId,
          id,
          account.accessToken,
          account.refreshToken,
          account.idToken,
          account.accessTokenExpiresAt,
          account.refreshTokenExpiresAt,
          account.scope,
          account.password,
          account.createdAt,
          account.updatedAt,
        ],
      );
    }

    map.set(user.id, id);
    created += 1;
  }

  return { map, matched, created };
}

/**
 * The sealed ElevenLabs keys.
 *
 * Copied as ciphertext, which only works because the merged deployment's SPOKEN_SECRET_KEY
 * is set to the zones deployment's ZONELORE_SECRET_KEY. AES-GCM offers no way to re-seal a
 * credential nothing can open, so getting that wrong means every collaborator pastes their
 * key again -- recoverable, but they have to be told.
 *
 * Skipped where the merged account already has one: the quests row won the email match, and
 * its owner's key is the one they set most recently.
 */
async function copyKeys(source, target, users) {
  const { rows } = await source.query(
    `select "userId", "ciphertext", "iv", "tag", "hint", "verifiedAt", "tier",
            "createdAt", "updatedAt"
       from "elevenlabs_key"`,
  );

  let copied = 0;
  for (const key of rows) {
    const userId = users.map.get(key.userId);
    if (!userId) continue;
    const result = await target.query(
      `insert into "elevenlabs_key" ("userId", "ciphertext", "iv", "tag", "hint",
                                     "verifiedAt", "tier", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict ("userId") do nothing`,
      [
        userId,
        key.ciphertext,
        key.iv,
        key.tag,
        key.hint,
        key.verifiedAt,
        key.tier,
        key.createdAt,
        key.updatedAt,
      ],
    );
    copied += result.rowCount ?? 0;
  }
  return copied;
}

/**
 * The lore corpus, every version and every language.
 *
 * Ids are not preserved -- nothing references a lore row by id -- but the ORDER is, so the
 * merged table's sequence hands them out in the order they were written. That matters for
 * the catalogue's stamp, which reads the highest id: a shuffled import would still be
 * correct, and this way the history reads the way it did.
 *
 * "editedBy" is text on both sides rather than a reference, which is why it crosses
 * unchanged: it holds whatever the zones site recorded, and turning a name into one of this
 * database's user ids would be inventing a match.
 */
async function copyLore(source, target) {
  // Replaced rather than added to, so this can be run again -- to stage the corpus before
  // the cutover, or to pick up lore edits made between then and the freeze. A corpus row
  // is derived from the pipeline's extraction, so there is nothing here to lose; the rows
  // that ARE somebody's work live in other tables and are never touched by this.
  //
  // Nothing references a lore row by id, so this leaves no dangling anything: takes,
  // flags and reports all address a line by its lineId, which the copy preserves.
  const replaced = await target.query(`delete from "lore_line"`);

  const { rows } = await source.query(
    `select "lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key",
            "name", "full", "short", "shortIsManual", "source", "editedBy", "note",
            "createdAt"
       from "lore_line" order by "id"`,
  );

  for (const row of rows) {
    await target.query(
      `insert into "lore_line" ("lineId", "lang", "version", "isCurrent", "origin", "mapID",
                                "kind", "key", "name", "full", "short", "shortIsManual",
                                "source", "editedBy", "note", "createdAt")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        row.lineId,
        row.lang,
        row.version,
        row.isCurrent,
        row.origin,
        row.mapID,
        row.kind,
        row.key,
        row.name,
        row.full,
        row.short,
        row.shortIsManual,
        row.source,
        row.editedBy,
        row.note,
        row.createdAt,
      ],
    );
  }

  return {
    rows: rows.length,
    langs: new Set(rows.map((row) => row.lang)).size,
    replaced: replaced.rowCount ?? 0,
  };
}

async function copyFlags(source, target) {
  // Replaced, for the reason copyLore gives: a flag is a verdict this database holds no
  // other copy of, so re-importing it is a no-op rather than a merge.
  const replaced = await target.query(`delete from "line_flag"`);

  const { rows } = await source.query(
    `select "lineId", "lang", "status", "note", "updatedAt" from "line_flag"`,
  );
  for (const row of rows) {
    await target.query(
      `insert into "line_flag" ("lineId", "lang", "status", "note", "updatedAt")
       values ($1, $2, $3, $4, $5)`,
      [row.lineId, row.lang, row.status, row.note, row.updatedAt],
    );
  }
  return { rows: rows.length, replaced: replaced.rowCount ?? 0 };
}

/**
 * Every take of every zone line, into the shared table.
 *
 * In version order within a line, so the merged ids run the way the history does. The
 * column names change here -- see TAKE_COLUMNS -- and "createdBy" is left null: the zones
 * table never recorded who generated a take, and guessing would be worse than the honest
 * gap the column is nullable for.
 */
async function copyTakes(source, target) {
  // Only this section's rows. The quests takes in the same table were carried across by
  // migration 0020 from a database restored wholesale, and are nothing to do with here.
  const replaced = await target.query(`delete from "take" where "source" = 'zones'`);

  const columns = TAKE_COLUMNS.map(([from]) => `"${from}"`).join(", ");
  const { rows } = await source.query(
    `select "lineId", "lang", "version", "isCurrent", "origin", "settings", "generatedAt",
            ${columns}
       from "voiceline_take" order by "lineId", "lang", "version"`,
  );

  const into = TAKE_COLUMNS.map(([, to]) => `"${to}"`).join(", ");
  const placeholders = TAKE_COLUMNS.map((_, i) => `$${i + 8}`).join(", ");

  for (const row of rows) {
    await target.query(
      `insert into "take" ("source", "lineId", "lang", "version", "isCurrent", "origin",
                           "settings", ${into}, "createdAt")
       values ('zones', $1, $2, $3, $4, $5, $6::jsonb, ${placeholders}, $7)`,
      [
        row.lineId,
        row.lang,
        row.version,
        row.isCurrent,
        row.origin,
        row.settings === null ? null : JSON.stringify(row.settings),
        row.generatedAt,
        ...TAKE_COLUMNS.map(([from]) => row[from] ?? null),
      ],
    );
  }

  return { rows: rows.length, replaced: replaced.rowCount ?? 0 };
}

/**
 * The reports, with their categories translated and their addresses filled in.
 *
 * A zones report had no address column: its report page is reached with the line already
 * identified. The merged table has one, so it is set to the line's audio path -- which is
 * exactly what a report filed through the merged site now carries, so a row from before the
 * cutover and one from after are the same shape.
 *
 * The path is resolved from the lore rows just imported rather than recomputed, because
 * assigning files is the pipeline's job and doing it a second way here is how the two start
 * disagreeing. A report about the project itself has no line and keeps no target.
 */
async function copyReports(source, target, users) {
  const { rows: files } = await target.query(
    `select "lineId", "file" from "take" where "source" = 'zones' and "isCurrent"`,
  );
  const fileOf = new Map(files.map((row) => [row.lineId, row.file]));

  const { rows } = await source.query(
    `select "lineId", "lang", "category", "body", "status", "userId", "name", "email", "ip",
            "createdAt", "resolvedAt", "resolvedBy"
       from "feedback" order by "id"`,
  );

  for (const row of rows) {
    await target.query(
      `insert into "report" ("source", "lang", "lineId", "target", "category", "body",
                             "status", "userId", "name", "email", "ip", "createdAt",
                             "resolvedAt", "resolvedBy")
       values ('zones', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.lang,
        row.lineId,
        row.lineId ? (fileOf.get(row.lineId) ?? null) : null,
        CATEGORY[row.category] ?? "other",
        row.body,
        row.status,
        row.userId ? (users.map.get(row.userId) ?? null) : null,
        row.name,
        row.email,
        row.ip,
        row.createdAt,
        row.resolvedAt,
        row.resolvedBy ? (users.map.get(row.resolvedBy) ?? null) : null,
      ],
    );
  }

  return rows.length;
}

main().catch((error) => {
  console.error(`migrate-legacy: ${error.message}`);
  process.exit(1);
});

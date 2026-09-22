// Writing an import's rows in batches, and saying how far it has got.
//
// The locale imports decide everything in memory and then write. Written a row at a time
// that was fine against a local database and not through the ssh tunnel production is
// reached by (scripts/db/import-locale.sh): every statement a round trip, twenty thousand
// of them, and a terminal that printed nothing for minutes. So rows go in BATCH at a time
// through unnest, and each phase keeps a counter on screen.

/** Rows per statement: big enough that the round trips stop mattering, small enough to stay one packet-ish. */
export const BATCH = 500;

export function* chunks(items, size = BATCH) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/**
 * A counter on one line of the terminal, or a line per step when stderr is not one (a log,
 * CI), where carriage returns would pile up into one unreadable line.
 */
export function progress(label, total) {
  const tty = process.stderr.isTTY;
  const show = (done) => {
    if (tty) process.stderr.write(`\r  ${label} ${done}/${total}`);
    else process.stderr.write(`  ${label} ${done}/${total}\n`);
  };
  if (total > 0) show(0);
  let done = 0;
  return {
    add(n) {
      done += n;
      show(done);
    },
    end() {
      if (tty && total > 0) process.stderr.write("\n");
    },
  };
}

/**
 * Names into entity_name, extracted: each a new version, live when `promote`, recorded
 * behind a person's edit otherwise (pipelines/lib/promote.mjs decides which).
 *
 * `names` are { kind, entityId, name, promote }. Run inside the caller's transaction.
 */
export async function writeNames(client, lang, names, label = "names") {
  const bar = progress(label, names.length);
  for (const batch of chunks(names)) {
    const retiring = batch.filter((name) => name.promote);
    if (retiring.length > 0) {
      await client.query(
        `update "entity_name" as e set "isCurrent" = false
           from unnest($1::text[], $2::text[]) as r("kind", "entityId")
          where e."kind" = r."kind" and e."entityId" = r."entityId"
            and e."lang" = $3 and e."isCurrent"`,
        [retiring.map((n) => n.kind), retiring.map((n) => String(n.entityId)), lang],
      );
    }
    await client.query(
      `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
       select r."kind", r."entityId", $1,
              coalesce((select max(m."version") from "entity_name" m
                         where m."kind" = r."kind" and m."entityId" = r."entityId"
                           and m."lang" = $1), 0) + 1,
              r."promote", 'extracted', r."name"
         from unnest($2::text[], $3::text[], $4::boolean[], $5::text[])
              as r("kind", "entityId", "promote", "name")`,
      [
        lang,
        batch.map((n) => n.kind),
        batch.map((n) => String(n.entityId)),
        batch.map((n) => n.promote),
        batch.map((n) => n.name),
      ],
    );
    bar.add(batch.length);
  }
  bar.end();
}

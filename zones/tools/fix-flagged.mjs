#!/usr/bin/env node
// Repairs the corpus lines the review flagged, guided by the reviewer's notes.
//
//   node tools/fix-flagged.mjs --dry-run     # model runs, nothing recorded
//   node tools/fix-flagged.mjs               # records fixes as new versions
//
// SPENDS REAL CLAUDE CREDITS (cached and resumable, like rewrite-lore.mjs).
//
// The full-corpus review (dist/review-findings.md) showed the leaks that survive
// the deterministic filters have no vocabulary of their own: obscure Cataclysm
// names and world-state stated as present fact. The reviewers -- with wiki access
// and a wider model -- did the era attribution and wrote it into line_flag.note.
// This pass hands each flagged line's note to the rewrite model, which only has
// to execute the edit: cut what the note names, restore the earlier state only
// where the article supports it, add nothing.
//
// Lines whose only issue is "too-short" are skipped -- there is nothing to cut,
// and filling them out would be invention. Fixes that fail validation (or still
// contain a phrase the note quoted from the old text) are not recorded; those
// lines keep their text and their flag, and the report says why.
//
// The `bad` flags are left in place either way: a fix is not a verdict, and the
// worklist stays the owner's to clear.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ROOT,
  cleanExtract,
  classicVariant,
  extractFromResponse,
  fetchClassicTitleIndex,
  fetchExtract,
  fetchFullExtract,
  makeShort,
  stripClassicSuffix,
} from "./lib/wiki.mjs";
import { assembleSource } from "./lib/sections.mjs";
import { DEFAULT_MODEL, rewrite } from "./lore/rewrite.mjs";
import { isEnabled, recordRewrite } from "./lore/store.mjs";
import * as db from "./voice/db.mjs";
import { loadEnvFile } from "./lib/env.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();

const REPORT_PATH = join(ROOT, "dist/fix-flagged.md");
const CONCURRENCY = 4;

const argv = process.argv.slice(2);
const flags = {
  dryRun: argv.includes("--dry-run"),
  model: argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : DEFAULT_MODEL,
  verbose: argv.includes("--verbose"),
};

/** "https://warcraft.wiki.gg/wiki/Agamand_Mills" -> "Agamand Mills". */
function titleFromSource(source) {
  const slug = String(source || "").split("/wiki/")[1];
  return slug ? decodeURIComponent(slug).replace(/_/g, " ") : null;
}

async function mapWithConcurrency(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

// Spans the note quotes from the old text must not survive into the fix. Only
// spans that actually occur in the old text count -- the note also quotes the
// *correct* vanilla condition, and that is content the fix is allowed to keep.
const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function quotedLeaks(note, current) {
  // An opening quote preceded by a letter, or a closing one followed by a letter,
  // is a possessive apostrophe, not a quotation -- "the tower's source" must not
  // yield the span "s source".
  const spans = [...note.matchAll(/(?<![a-zA-Z])['‘"“]([^'‘’"“”]{8,200})['’"”](?![a-zA-Z])/g)].map(
    (m) => m[1],
  );
  const haystack = ` ${flat(current)} `;
  return spans.filter((s) => haystack.includes(` ${flat(s)} `));
}

async function main() {
  if (!isEnabled()) {
    console.error("error: DATABASE_URL is not set; the flags live in the database.");
    process.exit(1);
  }

  // English only, threaded through the join rather than assumed by it: line_flag
  // has no lang column, so an unscoped join returns one current row per language
  // for each flagged line -- and every extra row is a billed model call whose
  // result recordRewrite would then record as the current *English* version.
  // The flags were written about the English text, and English is the corpus the
  // rewriter repairs; a translated line follows its source, it is not "fixed".
  const lang = "enUS";
  const { rows } = await db.query(
    `select f."lineId", f.note as "flagNote", f."updatedAt" as "flaggedAt", l.*
       from line_flag f
       join lore_line l on l."lineId" = f."lineId" and l."lang" = $1 and l."isCurrent"
      where f.status = 'bad'
      order by l."mapID", l."lineId"`,
    [lang],
  );

  // A note describes the text the reviewer read. If the line has changed since it
  // was flagged -- because a previous run of this tool already fixed it -- the note
  // no longer applies, and "fixing" the fix would bill a second model call to cut
  // material the first one already handled. Learned the expensive way: the first
  // double-run re-billed ~345 calls and re-edited 87 lines.
  const stale = rows.filter((r) => r.createdAt > r.flaggedAt);
  const skipped = rows.filter((r) => !stale.includes(r) && /^\[review: too-short\]/.test(r.flagNote));
  const targets = rows.filter((r) => !stale.includes(r) && !skipped.includes(r));
  console.log(
    `${rows.length} flagged lines: fixing ${targets.length}, skipping ${skipped.length} ` +
      `(too-short only), ${stale.length} already changed since flagging`,
  );

  const classicIndex = await fetchClassicTitleIndex({});

  // Wiki fetches serial (throttled and mostly cached), model calls concurrent.
  for (const row of targets) {
    const title = titleFromSource(row.source);
    if (!title) {
      row.error = "no source URL";
      continue;
    }
    const mainTitle = stripClassicSuffix(title);
    const main = extractFromResponse((await fetchFullExtract(mainTitle, {})).json, mainTitle);
    if (!main) {
      row.error = `no article text for ${mainTitle}`;
      continue;
    }
    let classicLead = null;
    const classicTitle = classicVariant(mainTitle, classicIndex);
    if (classicTitle) {
      const found = extractFromResponse((await fetchExtract(classicTitle, {})).json, classicTitle);
      if (found) classicLead = cleanExtract(found.text).full;
    }
    const assembled = assembleSource("a", main.text, classicLead);
    row.sourceText = cleanExtract(assembled.text, { verbose: flags.verbose }).full;
  }

  const usable = targets.filter((r) => !r.error);

  // One haystack of every source in the run, for the invention check's regional
  // vocabulary -- same rule as rewrite-lore.mjs.
  const vocabulary = usable.map((r) => r.sourceText).join(" ").toLowerCase();

  let done = 0;
  await mapWithConcurrency(usable, CONCURRENCY, async (row) => {
    const note = row.flagNote.replace(/^\[review: [^\]]+\]\s*/, "");
    row.result = await rewrite({
      name: row.name,
      source: row.sourceText,
      variant: "a",
      model: flags.model,
      vocabulary,
      fix: { current: row.full, note },
    });
    const survivors = quotedLeaks(note, row.full).filter((s) =>
      ` ${flat(row.result.text)} `.includes(` ${flat(s)} `),
    );
    if (survivors.length) {
      row.result.problems.push(`still contains flagged phrase: "${survivors[0]}"`);
    }
    done++;
    if (done % 25 === 0 || done === usable.length) console.log(`  fixed ${done}/${usable.length}`);
  });

  const clean = usable.filter((r) => r.result.text && !r.result.problems.length);
  const withheld = usable.filter((r) => !clean.includes(r));

  //--- report ----------------------------------------------------------------
  const out = [
    "# Note-guided fixes",
    "",
    `Model \`${flags.model}\`. ${usable.length} lines attempted: ${clean.length} fixed, ` +
      `${withheld.length} withheld by validation, ${skipped.length} skipped (too-short only), ` +
      `${targets.length - usable.length} without article text.`,
    "",
    "Every line here keeps its `bad` flag -- the fix changes what is being adjudicated,",
    "not whether it is. Withheld lines keep their previous text.",
    "",
  ];
  for (const row of [...withheld, ...clean]) {
    out.push(`## ${row.name} — \`${row.lineId}\``);
    out.push("");
    out.push(`> ${row.flagNote}`);
    out.push("");
    if (row.result.problems.length) {
      out.push(...row.result.problems.map((p) => `> **withheld**: ${p}`));
      out.push("");
    }
    out.push(`**Before (${row.full.length} chars):**`);
    out.push("");
    out.push(row.full);
    out.push("");
    out.push(`**After (${row.result.text.length} chars${row.result.problems.length ? ", not recorded" : ""}):**`);
    out.push("");
    out.push(row.result.text || "*(empty)*");
    out.push("");
  }
  await mkdir(join(ROOT, "dist"), { recursive: true });
  await writeFile(REPORT_PATH, out.join("\n"));
  console.log(`\nwrote ${REPORT_PATH}`);

  if (withheld.length) {
    console.log(`${withheld.length} withheld:`);
    for (const r of withheld) console.log(`  ! ${r.name}: ${r.result.problems.join("; ")}`);
  }

  if (flags.dryRun) {
    console.log(`\n--dry-run: nothing recorded. ${clean.length} fixes ready.`);
    return;
  }

  const entries = clean.map((r) => ({
    mapID: r.mapID,
    kind: r.kind,
    key: r.key,
    name: r.name,
    full: r.result.text,
    short: makeShort(r.result.text),
    source: r.source,
    note: `note-guided fix of a review flag, ${flags.model}`,
  }));
  const stats = await recordRewrite(entries);
  console.log(
    `recorded ${stats.inserted} new version(s): ${stats.promoted} promoted, ` +
      `${stats.heldBack} held back behind a hand edit, ${stats.unchanged} unchanged`,
  );
  if (stats.inserted) console.log("write the addon data files with:  make lore-export");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(db.close);

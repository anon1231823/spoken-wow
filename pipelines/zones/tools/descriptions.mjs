#!/usr/bin/env node
//
// curseforge/*.md -> the addon READMEs, and dist/descriptions/ for pasting.
//
//   node tools/descriptions.mjs            # check that everything is in step
//   node tools/descriptions.mjs --write    # regenerate
//
// CurseForge has no API for project descriptions, summaries or categories --
// upload-file is the only write endpoint it offers, and metadata editing is an
// open feature request rather than a thing. So a project page is updated by
// pasting into a web form, and the only question is where the text being pasted
// comes from.
//
// It comes from here. Each file under curseforge/ is one project page: the
// frontmatter is everything the form asks for besides the body, and the body is
// the description itself. The addon README that ships inside the zip is generated
// from the same body, so the page a player reads before installing and the file
// they get afterwards cannot say different things.
//
// The one thing this cannot do is confirm what is actually live on the site.
// `--write` records a hash of what it generated in curseforge/published.json only
// when told to; scripts/release.sh reads that to notice a description that has
// changed since it was last pasted.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "curseforge");
const OUT_DIR = join(ROOT, "dist/descriptions");

const GENERATED_NOTE =
  "<!-- GENERATED from curseforge/%s by tools/descriptions.mjs. Do not edit by hand. -->";

// A deliberately small YAML subset: `key: value` and `key:` followed by `- item`
// lines. Enough for the fields below, and a parser that cannot express anything
// else is a parser nobody has to reason about when a page stops rendering.
function parseFrontmatter(text, file) {
  if (!text.startsWith("---\n")) {
    throw new Error(`${file}: no frontmatter block`);
  }
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) {
    throw new Error(`${file}: frontmatter is not closed`);
  }

  const meta = {};
  let listKey = null;

  for (const raw of text.slice(4, end).split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("  - ")) {
      if (!listKey) throw new Error(`${file}: list item outside a key: ${line}`);
      meta[listKey].push(line.slice(4).trim());
      continue;
    }

    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!match) throw new Error(`${file}: cannot parse frontmatter line: ${line}`);

    const [, key, value] = match;
    if (value === "") {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = value;
      listKey = null;
    }
  }

  return { meta, body: text.slice(end + 5).trim() + "\n" };
}

const REQUIRED = ["project", "slug", "name", "summary", "categories", "license"];

// CurseForge's summary field. Enforced here rather than discovered in the form,
// where the failure is a truncated sentence nobody re-reads.
const SUMMARY_LIMIT = 255;

async function loadPages() {
  const files = (await readdir(SOURCE_DIR)).filter((f) => f.endsWith(".md")).sort();
  const pages = [];

  for (const file of files) {
    const text = await readFile(join(SOURCE_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(text, file);

    for (const key of REQUIRED) {
      if (meta[key] === undefined) throw new Error(`${file}: missing '${key}'`);
    }
    if (meta.summary.length > SUMMARY_LIMIT) {
      throw new Error(
        `${file}: summary is ${meta.summary.length} characters, over CurseForge's ${SUMMARY_LIMIT}`,
      );
    }
    if (!/^\d+$/.test(meta.project)) {
      throw new Error(`${file}: 'project' should be the numeric CurseForge project id`);
    }

    pages.push({ file, meta, body });
  }

  if (pages.length === 0) throw new Error(`no pages found in ${SOURCE_DIR}`);
  return pages;
}

// What gets pasted into the description field, and what ships as the README.
// Identical by construction; the note only appears in the generated README, since
// an HTML comment in the form would be pasted into the page.
function readmeFor(page) {
  return `${GENERATED_NOTE.replace("%s", page.file)}\n\n${page.body}`;
}

// Which descriptions have been pasted into the site, and at what content. The
// site cannot be read back -- there is no API -- so this is the only way to
// notice a description edited in the repository months ago and never pasted.
const PUBLISHED_PATH = join(SOURCE_DIR, "published.json");

function digest(body) {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

async function loadPublished() {
  return JSON.parse(await readFile(PUBLISHED_PATH, "utf8").catch(() => "{}"));
}

// Slugs whose description differs from what was last recorded as pasted.
// scripts/release.sh prints these; --drift is how it asks.
async function reportDrift(pages) {
  const published = await loadPublished();
  const stale = pages.filter((p) => published[p.meta.slug] !== digest(p.body));
  for (const page of stale) {
    const seen = published[page.meta.slug] ? "changed since" : "never recorded as";
    console.log(`${page.meta.slug}\t${seen} pasted`);
  }
  return stale.length;
}

async function main() {
  const write = process.argv.includes("--write");
  const pages = await loadPages();
  const drift = [];

  if (process.argv.includes("--drift")) {
    await reportDrift(pages);
    return;
  }

  // Says "what is in the repository now is what is on the site now". Run it
  // after pasting, not before: nothing here can verify the claim.
  if (process.argv.includes("--published")) {
    const published = await loadPublished();
    for (const page of pages) published[page.meta.slug] = digest(page.body);
    await writeFile(PUBLISHED_PATH, JSON.stringify(published, null, 2) + "\n");
    console.log(`recorded ${pages.length} description(s) as pasted`);
    return;
  }

  for (const page of pages) {
    const target = page.meta.addonReadme;
    if (!target) continue;

    const path = join(ROOT, target);
    const wanted = readmeFor(page);
    const current = await readFile(path, "utf8").catch(() => null);

    if (current === wanted) continue;

    if (write) {
      await writeFile(path, wanted);
      console.log(`wrote ${target}`);
    } else {
      drift.push(`${target} is out of step with curseforge/${page.file}`);
    }
  }

  if (write) {
    await mkdir(OUT_DIR, { recursive: true });
    for (const page of pages) {
      await writeFile(join(OUT_DIR, `${page.meta.slug}.md`), page.body);
    }
    console.log(`wrote ${pages.length} description(s) to dist/descriptions/`);
  }

  if (drift.length) {
    console.error("FAILED -- run `make descriptions`");
    for (const line of drift) console.error(`  ${line}`);
    process.exit(1);
  }

  if (!write) {
    console.log(`OK -- ${pages.length} project pages, READMEs in step`);
    for (const page of pages) {
      console.log(
        `     ${page.meta.slug} (${page.meta.project}): summary ${page.meta.summary.length}/${SUMMARY_LIMIT} chars`,
      );
    }
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});

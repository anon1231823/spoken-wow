#!/usr/bin/env node
//
// curseforge/<project>/*.md -> the addon READMEs, and dist/descriptions/ for pasting.
//
//   node scripts/descriptions.mjs              # check that everything is in step
//   node scripts/descriptions.mjs --write      # regenerate
//   node scripts/descriptions.mjs --drift      # pages changed since they were pasted
//   node scripts/descriptions.mjs --published  # record the current pages as pasted
//
// CurseForge has no API for project descriptions, summaries or categories --
// upload-file is the only write endpoint it offers, and metadata editing is an
// open feature request rather than a thing. So a project page is updated by
// pasting into a web form, and the only question is where the text being pasted
// comes from.
//
// It comes from here. Each file under curseforge/ is one project page: the
// frontmatter is everything the form asks for besides the body, and the body is
// the description itself. Where a page names an addonReadme, the README that
// ships inside the zip is generated from the same body, so the page a player
// reads before installing and the file they get afterwards cannot say different
// things.
//
// ONE DIRECTORY PER PROJECT GROUP, each with its own published.json: curseforge/
// quests/, zones/ and spoken/. They are separate because the groups are released
// separately and their hashes should not move together, and because the groups
// came from separate repositories and their page sets are still edited at
// different times.
//
// The one thing this cannot do is confirm what is actually live on the site.
// `--published` records a hash of every page, and is a claim you make after
// pasting rather than something verified here; `--drift` reports what has changed
// since, which is what scripts/*/release.sh prints before an upload.

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The monorepo root, two levels up from scripts/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURSEFORGE_DIR = join(ROOT, "curseforge");
const OUT_DIR = join(ROOT, "dist/descriptions");

const GENERATED_NOTE =
  "<!-- GENERATED from curseforge/%s by scripts/descriptions.mjs. Do not edit by hand. -->";

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

// Every directory under curseforge/ is a group of project pages. Discovered
// rather than listed, so adding a fourth addon is a directory and not an edit
// here -- and README.md files alongside the pages are skipped by the .md filter
// below only because they carry no frontmatter, so they are skipped by name.
const NOT_A_PAGE = new Set(["README.md"]);

async function loadGroups() {
  const entries = await readdir(CURSEFORGE_DIR);
  const groups = [];

  for (const name of entries.sort()) {
    const dir = join(CURSEFORGE_DIR, name);
    if (!(await stat(dir)).isDirectory()) continue;

    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".md") && !NOT_A_PAGE.has(f))
      .sort();
    const pages = [];

    for (const file of files) {
      const text = await readFile(join(dir, file), "utf8");
      const { meta, body } = parseFrontmatter(text, `${name}/${file}`);

      for (const key of REQUIRED) {
        if (meta[key] === undefined) throw new Error(`${name}/${file}: missing '${key}'`);
      }
      if (meta.summary.length > SUMMARY_LIMIT) {
        throw new Error(
          `${name}/${file}: summary is ${meta.summary.length} characters, over CurseForge's ${SUMMARY_LIMIT}`,
        );
      }
      if (!/^\d+$/.test(meta.project)) {
        throw new Error(`${name}/${file}: 'project' should be the numeric CurseForge project id`);
      }

      pages.push({ group: name, file, path: `${name}/${file}`, meta, body });
    }

    if (pages.length) groups.push({ name, dir, pages });
  }

  if (groups.length === 0) throw new Error(`no project pages found under ${CURSEFORGE_DIR}`);

  // A slug names a project, and two files claiming one would quietly overwrite
  // each other in dist/descriptions/ and share a published.json entry.
  const seen = new Map();
  for (const page of groups.flatMap((g) => g.pages)) {
    const first = seen.get(page.meta.slug);
    if (first) throw new Error(`${page.path} and ${first} both claim slug '${page.meta.slug}'`);
    seen.set(page.meta.slug, page.path);
  }

  return groups;
}

// What gets pasted into the description field, and what ships as the README.
// Identical by construction; the note only appears in the generated README, since
// an HTML comment in the form would be pasted into the page.
function readmeFor(page) {
  return `${GENERATED_NOTE.replace("%s", page.path)}\n\n${page.body}`;
}

// Which descriptions have been pasted into the site, and at what content. The
// site cannot be read back -- there is no API -- so this is the only way to
// notice a description edited in the repository months ago and never pasted.
function publishedPath(group) {
  return join(group.dir, "published.json");
}

function digest(body) {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

async function loadPublished(group) {
  return JSON.parse(await readFile(publishedPath(group), "utf8").catch(() => "{}"));
}

// Slugs whose description differs from what was last recorded as pasted.
// scripts/*/release.sh prints these; --drift is how it asks.
async function reportDrift(groups) {
  let stale = 0;
  for (const group of groups) {
    const published = await loadPublished(group);
    for (const page of group.pages) {
      if (published[page.meta.slug] === digest(page.body)) continue;
      const seen = published[page.meta.slug] ? "changed since" : "never recorded as";
      console.log(`${page.meta.slug}\t${seen} pasted`);
      stale++;
    }
  }
  return stale;
}

// --group=quests limits the run to one directory under curseforge/. Only --drift uses it, and
// only so that a release prints the pages that release is about: every project's pages are
// tracked here now, and a zones upload listing five unpasted quests pages is noise at exactly
// the moment somebody is working through a checklist.
function groupFilter() {
  const arg = process.argv.find((a) => a.startsWith("--group="));
  return arg ? arg.slice("--group=".length) : null;
}

async function main() {
  const write = process.argv.includes("--write");
  const only = groupFilter();
  const all = await loadGroups();
  const groups = only ? all.filter((g) => g.name === only) : all;
  if (only && groups.length === 0) throw new Error(`no such project group: curseforge/${only}`);
  const pages = groups.flatMap((g) => g.pages);
  const drift = [];

  if (process.argv.includes("--drift")) {
    await reportDrift(groups);
    return;
  }

  // Says "what is in the repository now is what is on the site now". Run it
  // after pasting, not before: nothing here can verify the claim.
  if (process.argv.includes("--published")) {
    for (const group of groups) {
      const published = await loadPublished(group);
      for (const page of group.pages) published[page.meta.slug] = digest(page.body);
      await writeFile(publishedPath(group), JSON.stringify(published, null, 2) + "\n");
    }
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
      drift.push(`${target} is out of step with curseforge/${page.path}`);
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
    for (const group of groups) {
      for (const page of group.pages) {
        console.log(
          `     ${page.meta.slug} (${page.meta.project}): summary ${page.meta.summary.length}/${SUMMARY_LIMIT} chars`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});

# SpokenBooks, phases 1–2: corpus and site section

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every vanilla book, letter and note from the vmangos world database into a versioned `book_line` table, and put a `/books` section on the site where the text can be reviewed and voicelines generated.

**Architecture:** A new `pipelines/books/` ESM package reads the vmangos MySQL that `pipelines/quests` already provisions, assembles `page_text` chains into books, and imports them into Postgres as `book_line` — shaped on `lore_line`, versioned the same way. `apps/web` grows a `/books` section that reads that table through `lib/books/`, following the zones Explorer. Everything runs locally against OrbStack; nothing touches the droplet.

**Tech Stack:** Node 24 ESM (`.mjs`, no build step, matching `pipelines/zones`), `mysql2` and `pg`, `node --test` for pipeline tests, Next.js 15 App Router + vitest for the site, Postgres 16 and MySQL 8 under OrbStack.

**Spec:** `docs/superpowers/specs/2026-09-18-books-design.md`

## Global Constraints

- **Ids are frozen from the first release.** Line id is `b:{pageTextID}`. Audio file is `{pageTextID}`, extension-less, store-relative to the books audio root (`shared/books/` in deployment) — the spec's `books/{pageTextID}` names the path from the shared audio root. Nothing else may derive either.
- **No droplet.** No `make web-deploy`, no `ssh`, no `rsync` to `<the droplet>`. The two live sites stay frozen per `AGENTS.md`.
- **Migrations are additive and forward-only**, per `deploy/quests/bin/migrate.sh`. Never edit a committed migration.
- **The table is the authority; generated Lua is an export of it.** No site code reads addon files.
- **`enUS` only**, but every query names its language, as `lore_line` requires.
- **Comment the why, not the what** (`AGENTS.md`). A comment naming the failure a line prevents is the house style; match the density of the surrounding files.
- **Do not merge Makefiles.** Books targets go in a new `make/books.mk`.
- Node is `>=18` in package manifests, matching `pipelines/zones/package.json`.

---

### Task 1: The books pipeline package, and text normalisation

**Files:**
- Create: `pipelines/books/package.json`
- Create: `pipelines/books/tools/lib/text.mjs`
- Create: `pipelines/books/tools/lib/text.test.mjs`
- Modify: `pnpm-workspace.yaml`
- Create: `pipelines/books/.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `normaliseText(raw: string): string`, `spokenText(text: string): string`, `isGeneratable(text: string): { generatable: boolean, skipReason: string|null }` from `tools/lib/text.mjs`.

Page text arrives from vmangos with literal `\r\n` line breaks and WoW's `$B` newline token, and some pages are pure markup or placeholders ("Texto Ausente"). `normaliseText` is what gets stored and shown; `spokenText` is what would be sent to ElevenLabs.

- [ ] **Step 1: Write the failing tests**

```javascript
// pipelines/books/tools/lib/text.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { normaliseText, spokenText, isGeneratable } from "./text.mjs";

test("CRLF becomes a newline", () => {
  assert.equal(normaliseText("Ola Morgan,\r\n\r\nOs negocios"), "Ola Morgan,\n\nOs negocios");
});

test("$B and $b are newlines, whatever their case", () => {
  assert.equal(normaliseText("Line one$BLine two$bLine three"), "Line one\nLine two\nLine three");
});

test("trailing whitespace on a line goes, blank runs collapse to one blank line", () => {
  assert.equal(normaliseText("One   \n\n\n\nTwo\n\n"), "One\n\nTwo");
});

test("spoken text drops the HTML the signed pages carry", () => {
  assert.equal(spokenText("<HTML><BODY><H1>Ledger</H1>Three crates.</BODY></HTML>"), "Ledger Three crates.");
});

test("spoken text keeps ordinary prose untouched apart from newlines", () => {
  assert.equal(spokenText("Dear sir,\n\nThe rains have come."), "Dear sir, The rains have come.");
});

test("an empty page is not generatable", () => {
  assert.deepEqual(isGeneratable(""), { generatable: false, skipReason: "empty" });
});

test("a placeholder page is not generatable", () => {
  assert.deepEqual(isGeneratable("Missing Text"), { generatable: false, skipReason: "placeholder" });
});

test("a page holding a substitution token is not generatable", () => {
  assert.deepEqual(isGeneratable("Greetings, $N."), { generatable: false, skipReason: "substitution" });
});

test("ordinary prose is generatable", () => {
  assert.deepEqual(isGeneratable("The rains have come."), { generatable: true, skipReason: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test pipelines/books/tools/lib/text.test.mjs`
Expected: FAIL — `Cannot find module './text.mjs'`.

- [ ] **Step 3: Write the module**

```javascript
// pipelines/books/tools/lib/text.mjs
// Page text as it comes out of vmangos, and as it goes to a narrator.
//
// Two forms, deliberately: `normaliseText` is stored and shown, so it keeps the shape of
// the page -- a letter's paragraphs are part of reading it. `spokenText` is what would be
// sent to ElevenLabs, where a newline buys nothing and the markup on the signed pages
// would be read aloud as tag names.
//
// No dependencies, so `node tools/extract.mjs` runs on a clone with nothing installed.

/** Pages whose text is a maintenance placeholder rather than anything a player reads. */
const PLACEHOLDERS = new Set(["missing text", "texto ausente", "test", "placeholder"]);

/** What the game substitutes at runtime and a recording cannot: $N, $C, $R, $Gx:y;. */
const SUBSTITUTION = /\$[a-zA-Z]/;

/**
 * Storage form: real newlines, no trailing spaces, no runs of blank lines.
 *
 * `$B` is WoW's newline token and appears in both cases in the same table, so matching
 * only the documented upper case leaves literal "$b" in the middle of a sentence.
 */
export function normaliseText(raw) {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\$[Bb]/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Narration form: one flowing paragraph, markup gone.
 *
 * Tags are replaced by a space rather than deleted, because "<H1>Ledger</H1>Three crates."
 * has no space of its own and deleting the tags would leave "LedgerThree".
 */
export function spokenText(text) {
  return normaliseText(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether this page can be voiced, and if not, why.
 *
 * Mirrors the quests corpus's `generatable`/`skipReason` pair: a page that cannot be
 * spoken is kept and labelled rather than dropped, so the explorer can show that the
 * game has it and say why it is silent.
 */
export function isGeneratable(text) {
  const spoken = spokenText(text);
  if (spoken === "") return { generatable: false, skipReason: "empty" };
  if (PLACEHOLDERS.has(spoken.toLowerCase())) return { generatable: false, skipReason: "placeholder" };
  if (SUBSTITUTION.test(spoken)) return { generatable: false, skipReason: "substitution" };
  return { generatable: true, skipReason: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test pipelines/books/tools/lib/text.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the package manifest, workspace entry and ignore file**

```json
{
  "name": "@spoken/books-pipeline",
  "private": true,
  "type": "module",
  "description": "The books pipeline: vmangos extract, book_line import, Lua export. mysql2 reads the world DB that pipelines/quests provisions; pg writes the corpus. Everything else stays on the standard library so the addon build runs on a clone with nothing installed.",
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test tools/**/*.test.mjs" },
  "dependencies": { "mysql2": "^3.11.0", "pg": "^8.13.1" }
}
```

In `pnpm-workspace.yaml`, add `  - pipelines/books` under `pipelines/zones`.

`pipelines/books/.gitignore`:

```
# The extract's intermediate output. book_line is the corpus; this is only what the
# importer read on the way there, and it is reproducible from the dump in minutes.
corpus/extract.json
```

- [ ] **Step 6: Install and verify the workspace sees the package**

Run: `pnpm install`
Expected: `@spoken/books-pipeline` appears in the install summary; `pnpm --filter @spoken/books-pipeline test` passes.

- [ ] **Step 7: Commit**

```bash
git add pipelines/books pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "The books pipeline has a home and knows how to read page text"
```

---

### Task 2: Ids and the runtime checksum

**Files:**
- Create: `pipelines/books/tools/lib/naming.mjs`
- Create: `pipelines/books/tools/lib/naming.test.mjs`

**Interfaces:**
- Consumes: `normaliseText`, `spokenText` from `tools/lib/text.mjs`.
- Produces: `lineIdFor(pageId: number): string`, `fileFor(pageId: number): string`, `pageChecksum(text: string): number`, `textHash(spoken: string): string`.

`pageChecksum` is the value the addon will recompute in Lua to tell two same-named books apart (objects 179547 and 179548 are both "A Dusty Tome"). It therefore has to be computable with nothing but string length, `string.byte` and integer arithmetic — no bitwise operators, which the 1.12-era Lua the other addons still support does not have.

- [ ] **Step 1: Write the failing tests**

```javascript
// pipelines/books/tools/lib/naming.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { lineIdFor, fileFor, pageChecksum, textHash } from "./naming.mjs";

test("the line id is the frozen b:{pageTextID}", () => {
  assert.equal(lineIdFor(1381), "b:1381");
});

test("the file is the page id alone, store-relative and extension-less", () => {
  assert.equal(fileFor(1381), "1381");
});

test("the checksum is stable for the same text", () => {
  assert.equal(pageChecksum("The rains have come."), pageChecksum("The rains have come."));
});

test("the checksum separates the two Dusty Tomes", () => {
  assert.notEqual(pageChecksum("A dry account of grain shipments."), pageChecksum("A ledger of debts owed."));
});

test("the checksum ignores what normalisation removes", () => {
  assert.equal(pageChecksum("One\r\n\r\nTwo"), pageChecksum("One$B$BTwo"));
});

test("the checksum stays inside Lua's exact integer range", () => {
  const big = "x".repeat(20000);
  assert.ok(pageChecksum(big) >= 0 && pageChecksum(big) < 2 ** 31);
});

test("the text hash is a sha1 of the spoken text", () => {
  assert.match(textHash("The rains have come."), /^[0-9a-f]{40}$/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test pipelines/books/tools/lib/naming.test.mjs`
Expected: FAIL — `Cannot find module './naming.mjs'`.

- [ ] **Step 3: Write the module**

```javascript
// pipelines/books/tools/lib/naming.mjs
// The frozen names, in one place, for the reason pipelines/zones/tools/voice/naming.mjs
// exists: AGENTS.md freezes line ids and audio filenames, so a second place that derives
// either is a second place that can drift and strand a sound pack every user has.

import { createHash } from "node:crypto";

import { normaliseText, spokenText } from "./text.mjs";

/** 'b:1381'. The addon's lookup value and the take table's lineId. */
export function lineIdFor(pageId) {
  return `b:${pageId}`;
}

/** Store-relative and extension-less, as the zones side names files: '1381'. */
export function fileFor(pageId) {
  return String(pageId);
}

// A checksum the addon can recompute in Lua.
//
// NOT a hash from a library. The addon has to compute this at runtime from the page the
// client is showing, on clients whose Lua has no bitwise operators and no md5, so the
// arithmetic is deliberately plain: multiply, add, modulo. Changing the constants here
// means re-exporting the data module, because the addon's tables are keyed on this.
//
// The modulus is a prime under 2^31, which keeps every intermediate value exact in Lua
// 5.0's doubles and keeps the result printable as an integer in the generated Lua.
const CHECKSUM_MODULUS = 2147483647;
const CHECKSUM_FACTOR = 31;

export function pageChecksum(text) {
  const normalised = normaliseText(text);
  let sum = normalised.length % CHECKSUM_MODULUS;
  for (let i = 0; i < normalised.length; i++) {
    sum = (sum * CHECKSUM_FACTOR + normalised.charCodeAt(i)) % CHECKSUM_MODULUS;
  }
  return sum;
}

/** sha1 of what would be spoken. Compared against a take's hash to spot stale audio. */
export function textHash(text) {
  return createHash("sha1").update(spokenText(text)).digest("hex");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test pipelines/books/tools/lib/naming.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add pipelines/books/tools/lib/naming.mjs pipelines/books/tools/lib/naming.test.mjs
git commit -m "Book pages have frozen ids and a checksum the addon can recompute"
```

---

### Task 3: Assembling pages into books

**Files:**
- Create: `pipelines/books/tools/lib/chains.mjs`
- Create: `pipelines/books/tools/lib/chains.test.mjs`

**Interfaces:**
- Consumes: `lineIdFor`, `fileFor`, `pageChecksum`, `textHash` from `tools/lib/naming.mjs`; `normaliseText`, `spokenText`, `isGeneratable` from `tools/lib/text.mjs`.
- Produces: `buildBooks({ pages, owners }): { entries: BookEntry[], orphans: number[] }` from `tools/lib/chains.mjs`, where a `BookEntry` is `{ lineId, pageId, bookId, pageNumber, pageCount, title, ownerKind, ownerIds, material, text, spoken, checksum, hash, file, generatable, skipReason }`.

Pure, so it can be tested without a database. The MySQL reader in Task 4 supplies `pages` (`{ entry, text, nextPage }`) and `owners` (`{ kind, id, name, firstPage, material }`).

- [ ] **Step 1: Write the failing tests**

```javascript
// pipelines/books/tools/lib/chains.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBooks } from "./chains.mjs";

const pages = [
  { entry: 10, text: "Page one.", nextPage: 11 },
  { entry: 11, text: "Page two.", nextPage: 12 },
  { entry: 12, text: "Page three.", nextPage: 0 },
  { entry: 20, text: "A note.", nextPage: 0 },
  { entry: 99, text: "Nobody owns this.", nextPage: 0 },
];

const owners = [
  { kind: "object", id: 179547, name: "A Dusty Tome", firstPage: 10, material: 1 },
  { kind: "item", id: 2794, name: "Stalvan's Note", firstPage: 20, material: 2 },
];

test("a chain becomes one entry per page, numbered in reading order", () => {
  const { entries } = buildBooks({ pages, owners });
  const chain = entries.filter((e) => e.bookId === 10);
  assert.deepEqual(chain.map((e) => e.pageNumber), [1, 2, 3]);
  assert.deepEqual(chain.map((e) => e.pageId), [10, 11, 12]);
  assert.deepEqual(chain.map((e) => e.pageCount), [3, 3, 3]);
});

test("every page of a chain carries the owner's title and material", () => {
  const { entries } = buildBooks({ pages, owners });
  const last = entries.find((e) => e.pageId === 12);
  assert.equal(last.title, "A Dusty Tome");
  assert.equal(last.ownerKind, "object");
  assert.deepEqual(last.ownerIds, [179547]);
  assert.equal(last.material, 1);
});

test("the line id and file are the frozen ones", () => {
  const { entries } = buildBooks({ pages, owners });
  const first = entries.find((e) => e.pageId === 10);
  assert.equal(first.lineId, "b:10");
  assert.equal(first.file, "10");
});

test("an item owner gives ownerKind 'item'", () => {
  const { entries } = buildBooks({ pages, owners });
  assert.equal(entries.find((e) => e.pageId === 20).ownerKind, "item");
});

test("a page no owner reaches is reported as an orphan, not emitted", () => {
  const { entries, orphans } = buildBooks({ pages, owners });
  assert.deepEqual(orphans, [99]);
  assert.equal(entries.find((e) => e.pageId === 99), undefined);
});

test("two owners of one chain both ride along, sorted, on every page", () => {
  const shared = [
    ...owners,
    { kind: "object", id: 179548, name: "A Dusty Tome", firstPage: 10, material: 1 },
  ];
  const { entries } = buildBooks({ pages, owners: shared });
  assert.deepEqual(entries.find((e) => e.pageId === 10).ownerIds, [179547, 179548]);
});

test("a cyclic next_page terminates instead of hanging", () => {
  const cyclic = [
    { entry: 30, text: "One.", nextPage: 31 },
    { entry: 31, text: "Two.", nextPage: 30 },
  ];
  const { entries } = buildBooks({
    pages: cyclic,
    owners: [{ kind: "object", id: 1, name: "Loop", firstPage: 30, material: 1 }],
  });
  assert.deepEqual(entries.map((e) => e.pageId), [30, 31]);
});

test("text, spoken text and voiceability come along per page", () => {
  const { entries } = buildBooks({
    pages: [{ entry: 40, text: "Greetings, $N.", nextPage: 0 }],
    owners: [{ kind: "item", id: 7, name: "Summons", firstPage: 40, material: 1 }],
  });
  assert.equal(entries[0].generatable, false);
  assert.equal(entries[0].skipReason, "substitution");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test pipelines/books/tools/lib/chains.test.mjs`
Expected: FAIL — `Cannot find module './chains.mjs'`.

- [ ] **Step 3: Write the module**

```javascript
// pipelines/books/tools/lib/chains.mjs
// page_text rows are a linked list; a book is what you get by walking it.
//
// Pure on purpose. The MySQL reader hands over two flat arrays and everything that decides
// what a book IS happens here, where it can be tested without a dump -- the dump is 400 MB
// and downloading it to find out whether page numbering is right is not a test cycle.

import { lineIdFor, fileFor, pageChecksum, textHash } from "./naming.mjs";
import { normaliseText, spokenText, isGeneratable } from "./text.mjs";

/**
 * Every voiceable page, plus the pages nothing in the world can open.
 *
 * Orphans are counted rather than dropped silently: vmangos carries page text for content
 * that was cut, and a number that moves between dumps is the signal that the extract's
 * owner queries have gone wrong -- which would otherwise look like a quieter corpus.
 */
export function buildBooks({ pages, owners }) {
  const byEntry = new Map(pages.map((page) => [page.entry, page]));

  // Several objects can open one chain, so owners collapse per first page rather than
  // per chain being claimed by whichever row was read last.
  const ownersByFirstPage = new Map();
  for (const owner of owners) {
    const existing = ownersByFirstPage.get(owner.firstPage);
    if (existing) {
      existing.ids.push(owner.id);
      continue;
    }
    ownersByFirstPage.set(owner.firstPage, {
      kind: owner.kind,
      ids: [owner.id],
      name: owner.name,
      material: owner.material,
    });
  }

  const entries = [];
  const reached = new Set();

  for (const [firstPage, owner] of ownersByFirstPage) {
    const chain = walk(firstPage, byEntry);
    for (const page of chain) reached.add(page.entry);

    const ownerIds = [...owner.ids].sort((a, b) => a - b);
    chain.forEach((page, index) => {
      const text = normaliseText(page.text);
      const { generatable, skipReason } = isGeneratable(text);
      entries.push({
        lineId: lineIdFor(page.entry),
        pageId: page.entry,
        bookId: firstPage,
        pageNumber: index + 1,
        pageCount: chain.length,
        title: owner.name,
        ownerKind: owner.kind,
        ownerIds,
        material: owner.material,
        text,
        spoken: spokenText(text),
        checksum: pageChecksum(text),
        hash: textHash(text),
        file: fileFor(page.entry),
        generatable,
        skipReason,
      });
    });
  }

  const orphans = pages.map((page) => page.entry).filter((entry) => !reached.has(entry));
  return { entries, orphans };
}

/**
 * The pages of one book, in reading order.
 *
 * `seen` is not defensive programming: a bad next_page loop in a dump would hang the
 * extract with no output and no error, which is the worst way to learn about it.
 */
function walk(firstPage, byEntry) {
  const chain = [];
  const seen = new Set();
  let entry = firstPage;
  while (entry && byEntry.has(entry) && !seen.has(entry)) {
    seen.add(entry);
    const page = byEntry.get(entry);
    chain.push(page);
    entry = page.nextPage;
  }
  return chain;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test pipelines/books/tools/lib/chains.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add pipelines/books/tools/lib/chains.mjs pipelines/books/tools/lib/chains.test.mjs
git commit -m "Page chains become books, and orphans get counted"
```

---

### Task 4: Reading the vmangos dump

**Files:**
- Create: `pipelines/books/tools/lib/world.mjs`
- Create: `pipelines/books/tools/extract.mjs`
- Create: `make/books.mk`
- Modify: `Makefile` (add `books` to whatever list the root dispatcher validates)

**Interfaces:**
- Consumes: `buildBooks` from `tools/lib/chains.mjs`.
- Produces: `readWorld(connection): Promise<{ pages, owners }>` from `tools/lib/world.mjs`; `pipelines/books/corpus/extract.json` written by `tools/extract.mjs`.

Two vmangos facts the queries must respect, both verified in `vmangos/core` `src/game/ObjectMgr.cpp`:

- `gameobject_template` and `item_template` hold **one row per content patch**. The server takes `max(patch)` at or below the patch it runs (`ObjectMgr.cpp:8143`, `:3820`). Ignoring this yields duplicate owners and 1.2-era names for 1.12 objects.
- A book GameObject is `type = 9`, and its first page is `data0`.

- [ ] **Step 1: Write the reader**

```javascript
// pipelines/books/tools/lib/world.mjs
// The vmangos world database, read once.
//
// PATCH IS NOT OPTIONAL. gameobject_template and item_template hold a row per content
// patch, and the server serves max(patch) <= the patch it runs (ObjectMgr.cpp:8143 and
// :3820). Selecting without it returns an object under several names at once, and the
// extract would emit a book whose title is the one it had in 1.2.
//
// page_text has no patch column, which is why it is selected plainly below rather than
// through the same window -- a difference worth seeing in the SQL instead of assuming.

/** The patch a 1.12 server serves. Matches tts_cli/sql_queries.py's default. */
export const PATCH = 10;

/** GAMEOBJECT_TYPE_TEXT. data0 is the first page_text entry. */
const GO_TYPE_TEXT = 9;

export async function readWorld(connection, patch = PATCH) {
  const [pageRows] = await connection.query(
    "SELECT `entry`, `text`, `next_page` FROM `page_text`",
  );

  const [objectRows] = await connection.query(
    `SELECT t1.entry AS id, t1.name AS name, t1.data0 AS firstPage
       FROM gameobject_template t1
      WHERE t1.type = ?
        AND t1.data0 > 0
        AND t1.patch = (SELECT MAX(t2.patch) FROM gameobject_template t2
                         WHERE t2.entry = t1.entry AND t2.patch <= ?)`,
    [GO_TYPE_TEXT, patch],
  );

  const [itemRows] = await connection.query(
    `SELECT t1.entry AS id, t1.name AS name, t1.page_text AS firstPage,
            t1.page_material AS material
       FROM item_template t1
      WHERE t1.page_text > 0
        AND t1.patch = (SELECT MAX(t2.patch) FROM item_template t2
                         WHERE t2.entry = t1.entry AND t2.patch <= ?)`,
    [patch],
  );

  return {
    pages: pageRows.map((row) => ({
      entry: row.entry,
      text: row.text,
      nextPage: row.next_page,
    })),
    owners: [
      // A GameObject's material is the frame art chosen by its display, not a column on
      // the template, so object books record 0 and the site shows "parchment" for them.
      ...objectRows.map((row) => ({
        kind: "object",
        id: row.id,
        name: row.name,
        firstPage: row.firstPage,
        material: 0,
      })),
      ...itemRows.map((row) => ({
        kind: "item",
        id: row.id,
        name: row.name,
        firstPage: row.firstPage,
        material: row.material,
      })),
    ],
  };
}
```

- [ ] **Step 2: Write the extract entry point**

```javascript
// pipelines/books/tools/extract.mjs
// vmangos -> corpus/extract.json.
//
// Writes a file rather than importing directly, for the reason the quests pipeline splits
// the same way: the dump is only reachable from a machine running the Docker MySQL, the
// import is not, and a reviewable intermediate makes "did the extract change" answerable
// with a diff instead of a database query.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import mysql from "mysql2/promise";

import { readWorld, PATCH } from "./lib/world.mjs";
import { buildBooks } from "./lib/chains.mjs";

const OUT = new URL("../corpus/extract.json", import.meta.url).pathname;

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "wow",
  database: process.env.MYSQL_DATABASE ?? "mangos",
});

try {
  const world = await readWorld(connection, Number(process.env.BOOKS_PATCH ?? PATCH));
  const { entries, orphans } = buildBooks(world);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({ entries, orphans }, null, 2)}\n`);

  const books = new Set(entries.map((entry) => entry.bookId));
  const silent = entries.filter((entry) => !entry.generatable);
  console.log(`${entries.length} pages, ${books.size} books, ${orphans.length} orphaned pages`);
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
```

- [ ] **Step 3: Write the Makefile**

```makefile
# The books pipeline: the vmangos extract, the corpus import, the addon export.
#
#     make books-extract     ->  make -f make/books.mk extract
#
# Its own file because AGENTS.md forbids merging the Makefiles: quests.mk and zones.mk
# already collide on a dozen target names and this one would collide with both.
#
# The MySQL is the quests pipeline's. One vmangos dump on the machine, loaded once, read by
# both extracts -- a second copy is 400 MB and another thing to keep in step.

.DEFAULT_GOAL := help
.PHONY: help db extract import test

PIPELINE := pipelines/books
QUESTS   := pipelines/quests

help: ## List the books targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

db: ## Start the vmangos MySQL (the quests pipeline's; loading the dump is its target)
	@docker compose -f $(QUESTS)/docker-compose.yml up -d mysql

extract: ## vmangos -> pipelines/books/corpus/extract.json
	@node $(PIPELINE)/tools/extract.mjs

import: ## corpus/extract.json -> book_line (needs DATABASE_URL)
	@node $(PIPELINE)/tools/import.mjs

test: ## The pipeline's unit tests
	@pnpm --filter @spoken/books-pipeline test
```

Then add `books` to the root `Makefile` alongside `quests`, `zones` and `web`, following whatever form the existing dispatch uses — read it before editing.

- [ ] **Step 4: Start OrbStack and the database**

Run: `orb start && make books-db`
Expected: `mysql-server` appears in `docker ps`.

If the vmangos dump has never been loaded on this machine, load it with the quests pipeline's own bootstrap (`pipelines/quests/tts_cli/init_db.py` via its CLI) — it downloads `db_latest` and loads `mangos.sql`. This takes a while and only has to happen once.

- [ ] **Step 5: Run the extract and record the real numbers**

Run: `make books-extract`
Expected: a line of the form `N pages, M books, K orphaned pages`, and `corpus/extract.json` on disk. **Write the three numbers into the commit message** — they are the first real sizing of this corpus and the spec says they were unknown.

- [ ] **Step 6: Sanity-check the output by hand**

Run: `python3 -c "import json;d=json.load(open('pipelines/books/corpus/extract.json'));e=d['entries'];print(sorted({x['title'] for x in e})[:20]);print([x for x in e if x['pageCount']>3][:1])"`
Expected: recognisable vanilla titles, and a multi-page chain numbered from 1.

- [ ] **Step 7: Commit**

```bash
git add pipelines/books/tools/lib/world.mjs pipelines/books/tools/extract.mjs make/books.mk Makefile
git commit -m "The books extract reads vmangos"
```

---

### Task 5: The `book_line` table

**Files:**
- Create: `apps/web/migrations/0026_book_line.sql`
- Create: `apps/web/migrations/0027_books_source.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the `book_line` table; `'books'` accepted by `take."source"` and `regeneration_job."source"`.

`0027` is separate because it alters two existing tables and `0026` only creates one — a failed constraint change should not take the new table down with it.

- [ ] **Step 1: Write `0026_book_line.sql`**

```sql
-- The books corpus: every page of every book, letter and note, with a history.
--
-- WHY A TABLE, WHEN 0022 SAYS EXTRACTED TEXT IS A FILE. 0022 draws the line at who wrote
-- the words: quest text is Blizzard's and lives in a committed corpus, zone lore is written
-- here and lives in a table. Book text is Blizzard's, so the rule points at a file. It is a
-- table anyway, deliberately: the review path for these lines is the zones one -- read a
-- page, correct what the narrator should say, generate, listen -- and that path needs a
-- live version and a history from the first day rather than after the first regret.
--
-- VERSIONED LIKE lore_line. A re-extract inserts a new version and promotes it only when
-- the current version is itself 'extracted'. Without that, `make books-import` is a command
-- that silently discards corrections, and therefore one nobody dares run against a corpus
-- somebody has been editing.
--
-- THE STRUCTURAL FIELDS RIDE ALONG because the Lua export has no other input. They are not
-- editable through the app: which pages exist, and in what order, is the extract's business.
-- An API that let a text edit change "pageId" would be one bad request from a line the
-- addon can never look up.
--
-- EVERY QUERY NAMES ITS LANGUAGE, for the reason lore_line gives: with more than one
-- language, "the current version of this line" has two answers, and an unscoped write
-- clears the other language's live flag. Only enUS exists today; locales_page_text carries
-- eight more on these same ids.
--
-- Additive and forward-only per deploy/quests/bin/migrate.sh: the table is new.

create table "book_line" (
  "id"        bigserial   primary key,

  -- 'b:1381'. pipelines/books/tools/lib/naming.mjs owns the format and nothing else
  -- derives it; AGENTS.md freezes it once a sound pack has shipped.
  "lineId"    text        not null,
  "lang"      text        not null default 'enUS',
  "version"   integer     not null,
  "isCurrent" boolean     not null default false,

  -- 'extracted' came out of the vmangos dump. 'edited' was written by a person here.
  -- No 'translated' yet: nothing produces one, and a value nothing writes is a value
  -- somebody will read as a promise.
  "origin"    text        not null check ("origin" in ('extracted', 'edited')),

  "pageId"    integer     not null,
  -- The chain's first page, which is what a GameObject or item actually points at. Two
  -- pages share a bookId exactly when they are pages of the same book.
  "bookId"    integer     not null,
  "pageNumber" integer    not null,
  "pageCount"  integer    not null,

  -- The owning object's or item's name. Not unique: objects 179547 and 179548 are both
  -- named "A Dusty Tome" and hold different text, which is why the addon's lookup carries
  -- a checksum as well as a title.
  "title"     text        not null,
  "ownerKind" text        not null check ("ownerKind" in ('object', 'item')),
  -- Every object or item that opens this book, sorted. More than one is common.
  "ownerIds"  integer[]   not null,
  -- item_template.page_material: the frame the client draws. 0 for GameObject books,
  -- whose material comes from the display rather than the template.
  "material"  integer     not null default 0,

  "text"      text        not null,
  -- Whether this page can be voiced at all, and if not, why. Kept and labelled rather
  -- than dropped, so the explorer can show that the game has a page and say why it is
  -- silent. Recomputed by the extract; see tools/lib/text.mjs.
  "generatable" boolean   not null default true,
  "skipReason"  text,

  -- Who, and why. Null for extracted rows: no person wrote them.
  "editedBy"  text,
  "note"      text,

  "createdAt" timestamptz not null default now(),

  unique ("lineId", "lang", "version")
);

-- Exactly one live version per line per language, enforced rather than trusted, for the
-- reason lore_line_current_idx exists: two rows claiming to be current make the export
-- ambiguous, and the export is what the addon ships.
create unique index "book_line_current_idx"
  on "book_line" ("lineId", "lang") where "isCurrent";

-- The history panel's query, and the export's ordering.
create index "book_line_line_idx" on "book_line" ("lineId", "lang", "version" desc);

-- The explorer lists pages under their book, which is this ordering exactly.
create index "book_line_book_idx" on "book_line" ("bookId", "pageNumber") where "isCurrent";
```

- [ ] **Step 2: Write `0027_books_source.sql`**

```sql
-- 'books' joins 'quests' and 'zones' as a source of takes and regeneration jobs.
--
-- 0024 wrote the check constraints with two values because there were two sides. The third
-- needs the same treatment in both tables or a books take cannot be inserted at all -- the
-- failure appears at generation time, after the ElevenLabs call has been paid for.
--
-- Additive and forward-only: the constraints widen, so every row that was valid stays valid
-- and the previous release still runs against this schema.

alter table "take"
  drop constraint if exists "take_source_check",
  add constraint "take_source_check" check ("source" in ('quests', 'zones', 'books'));

alter table "regeneration_job"
  drop constraint if exists "regeneration_job_source_check",
  add constraint "regeneration_job_source_check" check ("source" in ('quests', 'zones', 'books'));
```

- [ ] **Step 3: Check the real constraint names before applying**

Run: `psql "$DATABASE_URL" -c "\d take" | grep -i check`
Expected: the constraint names printed. If Postgres named them something other than `take_source_check`, correct the migration to match — `drop constraint if exists` on a wrong name silently leaves the old constraint in place, and the widening never happens.

- [ ] **Step 4: Apply both migrations locally**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/migrations/0026_book_line.sql -f apps/web/migrations/0027_books_source.sql`
Expected: `CREATE TABLE`, three `CREATE INDEX`, two `ALTER TABLE`.

- [ ] **Step 5: Verify the constraint actually widened**

Run: `psql "$DATABASE_URL" -c "insert into take (source, lang, file, lineId, version, isCurrent, origin) values ('books','enUS','0','b:0',1,false,'generated') returning id" && psql "$DATABASE_URL" -c "delete from take where lineId = 'b:0'"`
Expected: one row inserted, then deleted. A `violates check constraint` here means Step 3 was skipped.

- [ ] **Step 6: Commit**

```bash
git add apps/web/migrations/0026_book_line.sql apps/web/migrations/0027_books_source.sql
git commit -m "The books corpus has a table, and books takes are allowed"
```

---

### Task 6: Importing the extract

**Files:**
- Create: `pipelines/books/tools/lib/promote.mjs`
- Create: `pipelines/books/tools/lib/promote.test.mjs`
- Create: `pipelines/books/tools/import.mjs`

**Interfaces:**
- Consumes: `corpus/extract.json` from Task 4; `book_line` from Task 5.
- Produces: `decideImport(current, incoming): { action: 'skip'|'record'|'promote' }` from `tools/lib/promote.mjs`; rows in `book_line`.

The promotion rule is the whole reason this is a table, so it gets tested as a pure function; the SQL around it stays thin enough to read.

- [ ] **Step 1: Write the failing tests**

```javascript
// pipelines/books/tools/lib/promote.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { decideImport } from "./promote.mjs";

test("a line nobody has imported yet is promoted", () => {
  assert.deepEqual(decideImport(null, { text: "One." }), { action: "promote" });
});

test("identical text is not recorded at all", () => {
  assert.deepEqual(
    decideImport({ origin: "extracted", text: "One." }, { text: "One." }),
    { action: "skip" },
  );
});

test("new text over an extracted line is promoted", () => {
  assert.deepEqual(
    decideImport({ origin: "extracted", text: "One." }, { text: "Two." }),
    { action: "promote" },
  );
});

test("new text over an edited line is recorded but not promoted", () => {
  assert.deepEqual(
    decideImport({ origin: "edited", text: "One." }, { text: "Two." }),
    { action: "record" },
  );
});

test("identical text over an edited line is still nothing", () => {
  assert.deepEqual(
    decideImport({ origin: "edited", text: "One." }, { text: "One." }),
    { action: "skip" },
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test pipelines/books/tools/lib/promote.test.mjs`
Expected: FAIL — `Cannot find module './promote.mjs'`.

- [ ] **Step 3: Write the module**

```javascript
// pipelines/books/tools/lib/promote.mjs
// What a re-import does to a line that already exists.
//
// The rule lore_line's recordScrape follows, for the same reason: an import that could
// overwrite a correction is an import nobody dares run, and an import nobody runs means
// the corpus stops tracking the dump. Recording without promoting keeps upstream movement
// visible in the history where somebody can promote it deliberately.

/**
 * @param current the live row, or null if the line is new
 * @param incoming the extracted entry
 */
export function decideImport(current, incoming) {
  if (!current) return { action: "promote" };
  if (current.text === incoming.text) return { action: "skip" };
  return { action: current.origin === "edited" ? "record" : "promote" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test pipelines/books/tools/lib/promote.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the importer**

```javascript
// pipelines/books/tools/import.mjs
// corpus/extract.json -> book_line.
//
// Rerunnable by construction: every line goes through decideImport, so running this twice
// over the same extract writes nothing the second time. That is what makes it safe to run
// after every dump refresh.

import { readFile } from "node:fs/promises";

import pg from "pg";

import { decideImport } from "./lib/promote.mjs";

const IN = new URL("../corpus/extract.json", import.meta.url).pathname;
const LANG = "enUS";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set -- the corpus lives in Postgres");

const { entries } = JSON.parse(await readFile(IN, "utf8"));
const pool = new pg.Pool({ connectionString: url });

const counts = { promote: 0, record: 0, skip: 0 };

try {
  for (const entry of entries) {
    const { rows } = await pool.query(
      `select "version", "origin", "text" from "book_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [entry.lineId, LANG],
    );
    const current = rows[0] ?? null;
    const { action } = decideImport(current, entry);
    counts[action]++;
    if (action === "skip") continue;

    // One transaction per line, not one for the run: an import of thousands of rows that
    // fails halfway should leave the lines it managed, not roll back an hour of work.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: versions } = await client.query(
        `select coalesce(max("version"), 0) as "max" from "book_line"
          where "lineId" = $1 and "lang" = $2`,
        [entry.lineId, LANG],
      );
      const version = Number(versions[0].max) + 1;

      if (action === "promote") {
        await client.query(
          `update "book_line" set "isCurrent" = false
            where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
          [entry.lineId, LANG],
        );
      }

      await client.query(
        `insert into "book_line"
           ("lineId", "lang", "version", "isCurrent", "origin",
            "pageId", "bookId", "pageNumber", "pageCount",
            "title", "ownerKind", "ownerIds", "material",
            "text", "generatable", "skipReason")
         values ($1, $2, $3, $4, 'extracted',
                 $5, $6, $7, $8,
                 $9, $10, $11, $12,
                 $13, $14, $15)`,
        [
          entry.lineId, LANG, version, action === "promote",
          entry.pageId, entry.bookId, entry.pageNumber, entry.pageCount,
          entry.title, entry.ownerKind, entry.ownerIds, entry.material,
          entry.text, entry.generatable, entry.skipReason,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(`${counts.promote} promoted, ${counts.record} recorded, ${counts.skip} unchanged`);
} finally {
  await pool.end();
}
```

- [ ] **Step 6: Run the import, then run it again**

Run: `make books-import && make books-import`
Expected: the first run reports everything promoted; the **second reports everything unchanged and nothing promoted**. If the second run promotes anything, `decideImport` is being fed text that differs from what was stored — usually normalisation applied on one side only.

- [ ] **Step 7: Verify the shape of what landed**

Run: `psql "$DATABASE_URL" -c "select count(*) pages, count(distinct \"bookId\") books, count(*) filter (where not \"generatable\") silent from book_line where \"isCurrent\""`
Expected: the same three numbers the extract printed in Task 4.

- [ ] **Step 8: Commit**

```bash
git add pipelines/books/tools/lib/promote.mjs pipelines/books/tools/lib/promote.test.mjs pipelines/books/tools/import.mjs
git commit -m "The books corpus imports, and re-imports without discarding edits"
```

---

### Task 7: Reading the corpus from the site

**Files:**
- Create: `apps/web/src/lib/books/catalogue.ts`
- Create: `apps/web/src/lib/books/catalogue.test.ts`
- Create: `apps/web/src/lib/books/fields.ts`
- Create: `apps/web/src/lib/books/search.ts`
- Create: `apps/web/src/lib/books/search.test.ts`

**Interfaces:**
- Consumes: `query` from `@/lib/db`; the `book_line` table.
- Produces: `type BookPage`, `type BookFacets`, `bookFacets(lang): Promise<BookFacets>`, `bookPages(filters, lang): Promise<BookPage[]>` from `lib/books/catalogue.ts`; `OWNER_KINDS`, `MATERIALS` from `lib/books/fields.ts`; `matchPages(pages, request): BookPage[]` from `lib/books/search.ts`.

Read `apps/web/src/lib/zones/catalogue.ts` and `apps/web/src/lib/zones/search.ts` first and follow them — including `import "server-only"` at the top of anything that touches the pool, and the rule that client components import their dropdown options from a node-free module (`lib/line-fields.ts` explains why at length).

- [ ] **Step 1: Write the failing search tests**

```typescript
// apps/web/src/lib/books/search.test.ts
import { describe, expect, it } from "vitest";

import { matchPages } from "./search";
import type { BookPage } from "./catalogue";

const page = (over: Partial<BookPage>): BookPage => ({
  lineId: "b:10", pageId: 10, bookId: 10, pageNumber: 1, pageCount: 1,
  title: "A Dusty Tome", ownerKind: "object", ownerIds: [179547], material: 0,
  text: "A dry account of grain shipments.", generatable: true, skipReason: null,
  origin: "extracted", version: 1, file: "10", ...over,
});

describe("matchPages", () => {
  it("matches on the book's title", () => {
    const pages = [page({}), page({ lineId: "b:20", title: "Stalvan's Note" })];
    expect(matchPages(pages, { text: "dusty" }).map((p) => p.lineId)).toEqual(["b:10"]);
  });

  it("matches on the page's words", () => {
    const pages = [page({}), page({ lineId: "b:20", text: "A ledger of debts owed." })];
    expect(matchPages(pages, { text: "ledger" }).map((p) => p.lineId)).toEqual(["b:20"]);
  });

  it("filters by owner kind", () => {
    const pages = [page({}), page({ lineId: "b:20", ownerKind: "item" })];
    expect(matchPages(pages, { ownerKind: "item" }).map((p) => p.lineId)).toEqual(["b:20"]);
  });

  it("filters out the pages that cannot be voiced", () => {
    const pages = [page({}), page({ lineId: "b:20", generatable: false, skipReason: "substitution" })];
    expect(matchPages(pages, { voiceable: true }).map((p) => p.lineId)).toEqual(["b:10"]);
  });

  it("an empty request returns everything, in reading order", () => {
    const pages = [page({ lineId: "b:11", pageNumber: 2 }), page({})];
    expect(matchPages(pages, {}).map((p) => p.pageNumber)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @spoken/web test src/lib/books/search.test.ts`
Expected: FAIL — cannot resolve `./search`.

- [ ] **Step 3: Write `fields.ts`, `catalogue.ts` and `search.ts`**

`fields.ts` holds the closed sets, free of node imports, so the filter bar can import them from a client component:

```typescript
/**
 * The closed sets a book page's owner and material are drawn from.
 *
 * Node-free for the reason lib/line-fields.ts gives: the filter bar is a client component,
 * and importing catalogue.ts for these would drag the Postgres pool into the browser bundle.
 */
export const OWNER_KINDS = ["object", "item"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

/**
 * item_template.page_material, as the client draws it. 0 is what the extract records for
 * GameObject books, whose material comes from the display rather than the template.
 */
export const MATERIALS: Record<number, string> = {
  0: "parchment",
  1: "parchment",
  2: "stone",
  3: "marble",
  4: "silver",
  5: "bronze",
  6: "valentine",
  7: "illidan",
};
```

`catalogue.ts` reads live rows only, always naming the language, and returns pages already in reading order. `search.ts` filters an already-loaded array — the corpus is a few thousand rows, so the zones approach of filtering in memory holds here too, and it keeps the tests free of a database.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @spoken/web test src/lib/books/`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @spoken/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/books
git commit -m "The site can read the books corpus"
```

---

### Task 8: The `/books` section

**Files:**
- Create: `apps/web/src/app/books/page.tsx`
- Create: `apps/web/src/components/books/Explorer.tsx`
- Create: `apps/web/src/components/books/BookList.tsx`
- Create: `apps/web/src/components/books/PageRow.tsx`
- Create: `apps/web/src/components/books/SearchBar.tsx`
- Modify: the site's navigation component (find it with `grep -rn "/zones" apps/web/src/components apps/web/src/app/layout.tsx`)

**Interfaces:**
- Consumes: `bookFacets`, `bookPages`, `BookPage` from `lib/books/catalogue.ts`; `matchPages` from `lib/books/search.ts`; `OWNER_KINDS`, `MATERIALS` from `lib/books/fields.ts`; the existing shared player component used by `components/zones/Player.tsx`.
- Produces: the `/books` route.

Read `apps/web/src/app/zones/page.tsx` and `components/zones/Explorer.tsx` first and follow them, including `export const dynamic = "force-dynamic"` and the empty-corpus branch that says the import has not been run instead of throwing a stack trace at somebody.

A book reads as a chain, so `BookList` groups pages under their `title` in `pageNumber` order and shows `pageCount` beside it. A page row carries its text, its voiceability, and — where the take exists — the player and the regenerate control, exactly as the zones row does.

- [ ] **Step 1: Build the page and components**

Follow the zones section's structure file for file. Keep each component to one responsibility: `Explorer` owns filter state, `BookList` owns grouping, `PageRow` owns one page, `SearchBar` owns the input.

- [ ] **Step 2: Add the section to the navigation**

Whatever component lists Quests and Zones gets a Books entry beside them.

- [ ] **Step 3: Run the site and look at it**

Run: `pnpm --filter @spoken/web dev`
Expected: `/books` lists books by title, filters by owner kind and material, and searching for a word in a page finds that page.

- [ ] **Step 4: Check the empty-corpus path**

Run: `psql "$DATABASE_URL" -c 'begin; delete from book_line; select 1;'` in one session while loading `/books`, or point `DATABASE_URL` at a database with the migration and no rows.
Expected: the "nothing imported yet" message, not a stack trace.

- [ ] **Step 5: Typecheck and test**

Run: `pnpm --filter @spoken/web typecheck && pnpm --filter @spoken/web test`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/books apps/web/src/components/books
git commit -m "The site has a books section"
```

---

### Task 9: Generating a books voiceline

**Files:**
- Modify: `apps/web/src/lib/generation/` — the module that dispatches on `source` (find it with `grep -rn "'zones'" apps/web/src/lib/generation`)
- Modify: `apps/web/src/app/api/regenerate/` — the route's source validation
- Create: `apps/web/src/lib/books/regenerate.ts`

**Interfaces:**
- Consumes: `book_line`; the existing queue and ElevenLabs client; `take` with `source = 'books'`.
- Produces: a generate path that turns a `BookPage` into a take at `shared/books/{pageId}`.

Read `apps/web/src/lib/zones/regenerate.ts` and follow it. The books generator differs from the zones one in what it sends — `spokenText` of the page rather than lore prose — and in nothing else.

The spoken text and its hash must come from the pipeline's own helpers rather than being recomputed here, for the reason `lib/zones/catalogue.ts` states at the top: reimplementing normalising or hashing in the app is how the app and the generated audio start disagreeing. `apps/web/src/lib/zones/tools.ts` shows how a pipeline module is imported into the bundle; do the same with `pipelines/books/tools/lib/text.mjs` and `naming.mjs`.

- [ ] **Step 1: Wire the source through**

Add `'books'` wherever `'zones'` and `'quests'` are enumerated in the generation path, and point it at the new module.

- [ ] **Step 2: Generate one page and listen to it**

Pick a short, voiceable page in the explorer and generate it.
Expected: a take row with `source = 'books'`, an mp3 in the books audio store, and audio that plays in the page row.

- [ ] **Step 3: Confirm staleness detection works**

Edit that page's text in the explorer, then reload.
Expected: the row reports the take as stale, because today's hash differs from the take's `spokenHash`.

- [ ] **Step 4: Typecheck and test**

Run: `pnpm --filter @spoken/web typecheck && pnpm --filter @spoken/web test`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/books/regenerate.ts apps/web/src/lib/generation apps/web/src/app/api/regenerate
git commit -m "Book pages can be voiced"
```

---

### Task 10: Documentation, and the phase-2 report

**Files:**
- Create: `docs/books/README.md`
- Create: `docs/books/AGENTS.md`
- Modify: `README.md` (the addon table's SpokenBooks row, and the Layout block)
- Modify: `AGENTS.md` (the frozen-ids rule gains `b:{pageTextID}`)
- Modify: `CLAUDE.md` (the per-project guidance list)

**Interfaces:**
- Consumes: everything above.
- Produces: the prose the next reader needs, which `README.md` calls the primary reference.

- [ ] **Step 1: Write `docs/books/README.md`**

What the books side is, where the text comes from and why client files and Wowhead are not options, the five stages, the real corpus numbers from Task 4, and how to run the whole thing locally under OrbStack.

- [ ] **Step 2: Write `docs/books/AGENTS.md`**

The conventions specific to this side: ids are frozen, the table is the authority and the Lua is an export, the extract must respect `patch`, the checksum constants cannot change without re-exporting the data module.

- [ ] **Step 3: Update the three root documents**

`README.md`'s table says SpokenBooks is planned — it is now shipping a corpus and a site section, and the Layout block gains `pipelines/books`. `AGENTS.md`'s frozen-ids rule lists `q:33:accept`, `g:{md5}`, `z:{mapID}` and `s:{mapID}:{key}`; add `b:{pageTextID}`. `CLAUDE.md` lists per-project guidance; add the books pair.

- [ ] **Step 4: Commit**

```bash
git add docs/books README.md AGENTS.md CLAUDE.md
git commit -m "The books side has its own prose"
```

- [ ] **Step 5: Report**

Phases 1–2 are done. Report the corpus numbers, what `/books` can do, and what is waiting: the addon, its data export, and the sound pack. Review and voiceline generation can start here, in parallel with phase 3.

---

## What this plan does not cover

Phase 3 (the `SpokenBooks` addon, the Lua export, `tests/lua/` coverage of the lookup and the mail exclusion) and phase 4 (release scripts, sound-pack packaging) get their own plan, written once the corpus numbers from Task 4 exist — the data module's shape depends on how many books there turn out to be.

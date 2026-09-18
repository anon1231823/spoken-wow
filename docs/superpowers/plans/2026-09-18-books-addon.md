# SpokenBooks, phase 3: the addon

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read books, letters and notes aloud in game — the addon, the data it looks pages up in, and the sound pack that holds the narration.

**Architecture:** `book_line` exports to committed Lua under `addons/SpokenBooks/Data/`, and the `take` table exports to `addons/SpokenBooksAudio/Data/Sounds.lua`. The addon hooks `ITEM_TEXT_*`, identifies the page on screen by title, page number and a checksum of its text, and queues the book's remaining pages through `SpokenPlayer` — which already names `"books"` as a source key.

**Tech Stack:** Lua 5.1 (Era 11509, Anniversary 20506, Forever 16001), Node ESM for the exports, `tests/lua/` under luajit.

**Spec:** `docs/superpowers/specs/2026-09-18-books-design.md`

**Prior phases:** `docs/superpowers/plans/2026-09-18-books-corpus-and-section.md` (shipped).

## Global Constraints

- **Frozen ids**, per `AGENTS.md`: line id `b:{pageTextID}`, audio file `{pageTextID}`, extension-less and store-relative.
- **The checksum constants cannot move.** `CHECKSUM_MODULUS = 2147483647`, `CHECKSUM_FACTOR = 31`, taken over **UTF-8 bytes** (`pipelines/books/tools/lib/naming.mjs`). The Lua must produce the same number for the same text or every lookup misses.
- **The table is the corpus; the Lua is an export of it.** Generated files carry the "AUTO-GENERATED … Do not edit by hand" header the zones ones do, and a clone with no Postgres must still build the addon from what is committed.
- **`## Interface: 11509, 20506, 16001`** — the three flavours, as `SpokenZones.toc` and `SpokenZonesAudio.toc` already declare them.
- **Everything plays through `SpokenPlayer`.** The addon owns no queue, no frame and no channel; it registers a source and enqueues clips. `Spoken:IsCompatible(1)` is the entire hard requirement.
- **No droplet, no deploy.** This phase ships an addon, not a site change.
- **Comment the why, not the what.** Match the density of `addons/SpokenZones/*.lua`.

---

### Task 1: The lookup, in Lua

**Files:**
- Create: `pipelines/books/tools/lib/lua.mjs`
- Create: `pipelines/books/tools/lib/lua.test.mjs`

**Interfaces:**
- Consumes: `pageChecksum` from `tools/lib/naming.mjs`.
- Produces: `booksLua(entries): string` from `tools/lib/lua.mjs`.

The addon needs three things from the corpus and nothing else: which page a screen of text is, which pages follow it, and what to call the book. Text itself never ships — the addon has the words on screen already.

```lua
SpokenBooksData = {
    version = 1,
    -- title -> page number -> checksum -> pageId
    index = { ["A Dusty Tome"] = { [1] = { [1734986221] = 179547 } } },
    -- a fallback for when the title does not match: checksum -> pageId
    loose = { [1734986221] = 179547 },
    -- pageId -> the book it belongs to, and where in it
    pages = { [179547] = { book = 10, number = 1 } },
    -- first page -> every page in reading order
    books = { [10] = { title = "A Dusty Tome", pages = { 10, 11, 12 } } },
}
```

- [ ] **Step 1: Write the failing test**

```javascript
// pipelines/books/tools/lib/lua.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { booksLua } from "./lua.mjs";
import { pageChecksum } from "./naming.mjs";

const entries = [
  { pageId: 10, bookId: 10, pageNumber: 1, pageCount: 2, title: "A Dusty Tome", text: "One." },
  { pageId: 11, bookId: 10, pageNumber: 2, pageCount: 2, title: "A Dusty Tome", text: "Two." },
  { pageId: 20, bookId: 20, pageNumber: 1, pageCount: 1, title: "A Note", text: "Three." },
];

test("the header says the file is generated", () => {
  assert.match(booksLua(entries), /AUTO-GENERATED[\s\S]*Do not edit by hand/);
});

test("a page is indexed by title, number and checksum", () => {
  const lua = booksLua(entries);
  assert.ok(lua.includes(`["A Dusty Tome"]`));
  assert.ok(lua.includes(`[${pageChecksum("One.")}] = 10`));
});

test("every page is reachable by checksum alone, for a title that does not match", () => {
  assert.ok(booksLua(entries).includes(`loose`));
});

test("a book lists its pages in reading order", () => {
  assert.match(booksLua(entries), /\[10\] = \{ title = "A Dusty Tome", pages = \{ 10, 11 \} \}/);
});

test("a quote in a title is escaped", () => {
  const lua = booksLua([
    { pageId: 1, bookId: 1, pageNumber: 1, pageCount: 1, title: 'The "Book"', text: "x" },
  ]);
  assert.ok(lua.includes('["The \\"Book\\""]'));
});

test("two pages of one book with identical text keep both checksummed entries", () => {
  // The checksum collides by construction here; the later page must not drop the earlier.
  const same = [
    { pageId: 1, bookId: 1, pageNumber: 1, pageCount: 2, title: "Ledger", text: "..." },
    { pageId: 2, bookId: 1, pageNumber: 2, pageCount: 2, title: "Ledger", text: "..." },
  ];
  const lua = booksLua(same);
  assert.ok(lua.includes("[1] = {"), "page 1 indexed");
  assert.ok(lua.includes("[2] = {"), "page 2 indexed");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test pipelines/books/tools/lib/lua.test.mjs`
Expected: FAIL — `Cannot find module './lua.mjs'`.

- [ ] **Step 3: Write the module**

Emit the table above, sorted by every key so a re-export produces a diff only where the corpus moved. `loose` maps a checksum to a page id, and records only checksums that are unique corpus-wide: a fallback that can return the wrong page is worse than one that returns nothing, because the wrong page reads the wrong words aloud.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test pipelines/books/tools/lib/lua.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add pipelines/books/tools/lib/lua.mjs pipelines/books/tools/lib/lua.test.mjs
git commit -m "The corpus can be written as the addon's lookup"
```

---

### Task 2: Exporting the lookup and the sound pack

**Files:**
- Create: `pipelines/books/tools/export.mjs`
- Create: `pipelines/books/tools/build-lookup.mjs`
- Modify: `make/books.mk`

**Interfaces:**
- Consumes: `booksLua` from `tools/lib/lua.mjs`; `book_line` and `take` in Postgres.
- Produces: `addons/SpokenBooks/Data/Books.lua`, `addons/SpokenBooksAudio/Data/Sounds.lua`; `make books-export`, `make books-lookup`.

Two exports, because they answer to different things. The lookup is the corpus and changes when a page's text does; the sound pack's table is the takes and changes when a clip is cut. `Sounds.lua` mirrors the zones pack exactly — durations recorded at generation time, because the client cannot report how long a file is and without them the Play button never resets.

```lua
SpokenBooksAudioPacks = SpokenBooksAudioPacks or {}
SpokenBooksAudioPacks[ADDON_NAME] = {
    version = 1, addon = ADDON_NAME, quality = "high", bitrate = 128,
    pages = { [1381] = { file = "1381", len = 12.34 } },
}
```

- [ ] **Step 1: Write `export.mjs`**

Reads live `book_line` rows for `enUS`, writes `addons/SpokenBooks/Data/Books.lua`. Requires `DATABASE_URL`; refuses with a message naming `make books-import` when the table is empty.

- [ ] **Step 2: Write `build-lookup.mjs`**

Reads current `take` rows with `source = 'books'` joined to the corpus, writes `addons/SpokenBooksAudio/Data/Sounds.lua`. A page with no take is simply absent — the addon then has nothing to play for it and says so, which is the zones rule: there is no stand-in clip.

- [ ] **Step 3: Add the targets**

```makefile
export: ## book_line -> addons/SpokenBooks/Data/Books.lua (needs DATABASE_URL)
	@node $(PIPELINE)/tools/export.mjs

lookup: ## take -> addons/SpokenBooksAudio/Data/Sounds.lua (needs DATABASE_URL)
	@node $(PIPELINE)/tools/build-lookup.mjs
```

- [ ] **Step 4: Run both against the local database**

Run: `DATABASE_URL='postgres://localhost/spoken_quests_dev' make books-export books-lookup`
Expected: `Books.lua` with 404 books and 1191 pages; `Sounds.lua` with however many takes exist locally.

- [ ] **Step 5: Check the Lua parses**

Run: `luajit -e 'dofile("addons/SpokenBooks/Data/Books.lua"); print(#SpokenBooksData.books)'` (or the loop the zones validator uses)
Expected: no syntax error.

- [ ] **Step 6: Commit**

```bash
git add pipelines/books/tools/export.mjs pipelines/books/tools/build-lookup.mjs make/books.mk addons/SpokenBooks/Data addons/SpokenBooksAudio/Data
git commit -m "The corpus and the takes export to the addon"
```

---

### Task 3: The addon, registered with the player

**Files:**
- Create: `addons/SpokenBooks/SpokenBooks.toc`
- Create: `addons/SpokenBooks/Core.lua`
- Create: `addons/SpokenBooks/Checksum.lua`
- Create: `tests/lua/books_source_test.lua`
- Modify: `Makefile` (the `test-player` list)

**Interfaces:**
- Consumes: `Spoken:RegisterSource("books", info)`, `Spoken:IsCompatible(1)`.
- Produces: `SpokenBooks.source`, `SpokenBooks:ChecksumOf(text)`.

`Checksum.lua` is the Lua half of `naming.mjs`: same modulus, same factor, over `string.byte`. It is the piece most likely to drift, so it is a file of its own with its own test.

- [ ] **Step 1: Write the failing test**

```lua
-- tests/lua/books_source_test.lua (first section)
Expect("the books addon registers a source with the player", Spoken:GetSource("books"), B.source)
Expect("...and refuses to load against an older player", B.compatible, true)
-- The checksums the export computed, recomputed here from the same strings.
Expect("the checksum matches the exporter on ASCII", B:ChecksumOf("The rains have come."), 1178939165)
Expect("the checksum matches the exporter on UTF-8", B:ChecksumOf("Voilà, l'épée."), 1651000944)
```

The two expected numbers come from running `node -e` against `pageChecksum` — put the real values in, never a placeholder.

- [ ] **Step 2: Run to verify it fails**

Run: `make test-player`
Expected: FAIL — the test file cannot find `addons/SpokenBooks`.

- [ ] **Step 3: Write the TOC, `Checksum.lua` and `Core.lua`**

`Core.lua` registers the source with `queueLimit = 1` — a book is read one page at a time and falling pages behind the reader is worse than dropping them — and `interClipGap = 0.35`.

- [ ] **Step 4: Run to verify it passes**

Run: `make test-player`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add addons/SpokenBooks tests/lua/books_source_test.lua Makefile
git commit -m "The books addon joins the player"
```

---

### Task 4: Reading a page, and not reading the mail

**Files:**
- Create: `addons/SpokenBooks/Reader.lua`
- Modify: `addons/SpokenBooks/SpokenBooks.toc`
- Modify: `tests/lua/books_source_test.lua`
- Modify: `tests/lua/wow_client_stub.lua` (the `ItemText*` API and its events)

**Interfaces:**
- Consumes: `ITEM_TEXT_BEGIN`, `ITEM_TEXT_READY`, `ITEM_TEXT_CLOSED`, `ItemTextGetText()`, `ItemTextGetItem()`, `ItemTextGetPage()`, `ItemTextGetCreator()`, `ItemTextHasNextPage()`.
- Produces: `SpokenBooks:PageOnScreen() -> pageId|nil`, `SpokenBooks:OnTextReady()`.

Identification order, and each step earns its place: title plus page number plus checksum; then checksum alone through `loose`, for a client whose object name differs from the corpus's; then nothing, silently, because the alternative is reading the wrong page's words aloud.

- [ ] **Step 1: Write the failing tests**

```lua
-- Mail is not a book. ItemTextFrame serves both.
Expect("a letter with a creator is not read", B:PageOnScreen(), nil)
Expect("the frame under MailFrame is not read", B:PageOnScreen(), nil)
-- Two objects named "A Dusty Tome" hold different text; the checksum separates them.
Expect("the right Dusty Tome is found", B:PageOnScreen(), 179548)
Expect("an unknown page is nil rather than a guess", B:PageOnScreen(), nil)
```

- [ ] **Step 2: Run to verify they fail**

Run: `make test-player`
Expected: FAIL.

- [ ] **Step 3: Extend the client stub and write `Reader.lua`**

- [ ] **Step 4: Run to verify they pass**

Run: `make test-player`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add addons/SpokenBooks/Reader.lua addons/SpokenBooks/SpokenBooks.toc tests/lua
git commit -m "The addon knows which page is on screen, and that mail is not one"
```

---

### Task 5: The playlist

**Files:**
- Create: `addons/SpokenBooks/Playlist.lua`
- Modify: `addons/SpokenBooks/SpokenBooks.toc`
- Modify: `tests/lua/books_source_test.lua`

**Interfaces:**
- Consumes: `SpokenBooksData.books`, `SpokenBooks:PageOnScreen()`, the player's source `Enqueue`/`Remove`/`StopAll`.
- Produces: `SpokenBooks:PlayFrom(pageId)`, `SpokenBooks:SyncTo(pageId)`.

Opening page 1 queues the whole chain, so a twenty-page journal reads straight through. Turning the page re-syncs rather than restarting: if the reader turns to a page already queued, nothing happens — the clip for it is coming. If they turn somewhere else, the queue is dropped and rebuilt from there.

- [ ] **Step 1: Write the failing tests**

```lua
Expect("opening page 1 queues the whole book", H.QueuedKeys(), { "b:10", "b:11", "b:12" })
Expect("turning to a queued page changes nothing", H.QueuedKeys(), { "b:10", "b:11", "b:12" })
Expect("turning elsewhere rebuilds from there", H.QueuedKeys(), { "b:12" })
Expect("closing the frame stops this source only", H.QueuedKeys(), {})
Expect("a page with no clip in the pack is skipped, not silent-queued", H.QueuedKeys(), { "b:10", "b:12" })
```

- [ ] **Step 2: Run to verify they fail**

Run: `make test-player`
Expected: FAIL.

- [ ] **Step 3: Write `Playlist.lua`**

- [ ] **Step 4: Run to verify they pass**

Run: `make test-player`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add addons/SpokenBooks/Playlist.lua addons/SpokenBooks/SpokenBooks.toc tests/lua/books_source_test.lua
git commit -m "A book reads straight through, and a page turn re-syncs it"
```

---

### Task 6: Audio, options and autoplay

**Files:**
- Create: `addons/SpokenBooks/Audio.lua`
- Create: `addons/SpokenBooks/UI/Options.lua`
- Create: `addons/SpokenBooksAudio/SpokenBooksAudio.toc`
- Create: `tests/lua/books_options_test.lua`
- Modify: `addons/SpokenBooks/SpokenBooks.toc`, `Makefile`

**Interfaces:**
- Consumes: `SpokenBooksAudioPacks`, `SpokenBooksDB`.
- Produces: `SpokenBooks:ClipFor(pageId)`, the options panel.

`Audio.lua` is the zones one's shape, minus the language tiers books does not have yet: packs register themselves into `SpokenBooksAudioPacks`, this picks one, and a page with no clip in it plays nothing and says why. **No stand-in clip**, for the reason `addons/SpokenZones/Audio.lua` gives at length.

Autoplay defaults **on**: opening a book is already a deliberate act, unlike walking into a zone. The toggle is there for whoever disagrees.

- [ ] **Step 1: Write the failing options test**

```lua
Expect("autoplay is on by default", SpokenBooksDB.autoplay, true)
Expect("turning it off stops a page from queueing itself", H.QueuedKeys(), {})
Expect("with it off, the player's play control still works", H.QueuedKeys(), { "b:10" })
```

- [ ] **Step 2: Run to verify it fails, write the files, run again**

Run: `make test-player`

- [ ] **Step 3: Add the test to the `test-player` list in `Makefile`**

- [ ] **Step 4: Commit**

```bash
git add addons/SpokenBooks addons/SpokenBooksAudio tests/lua/books_options_test.lua Makefile
git commit -m "Books narration has a pack, a panel and an autoplay switch"
```

---

### Task 7: Publishing a take to the addon

**Files:**
- Create: `apps/web/src/lib/books/publish.ts`
- Modify: `apps/web/src/lib/generation/worker.ts`
- Modify: `apps/web/src/app/api/books/regenerate/route.ts`

**Interfaces:**
- Consumes: `build-lookup.mjs` through `lib/books/tools.ts`.
- Produces: `publish()` for books, wired into `afterDrain` and the single-page route.

Until now the worker has had no `afterDrain` entry for books and the regenerate route published nothing, both with comments saying why: there was no lookup to rebuild. There is one now, so both get wired, and those comments go.

- [ ] **Step 1: Wire it, following `lib/zones/regenerate.ts`'s `publish`**

- [ ] **Step 2: Generate one page locally and confirm `Sounds.lua` gains its row**

Run: the explorer's regenerate on one page, then `git diff addons/SpokenBooksAudio/Data/Sounds.lua`
Expected: one row added, with a real duration.

- [ ] **Step 3: Typecheck, test, commit**

Run: `pnpm --filter @spoken/web typecheck && pnpm --filter @spoken/web test`

```bash
git add apps/web/src/lib/books apps/web/src/lib/generation/worker.ts apps/web/src/app/api/books/regenerate
git commit -m "A finished book take reaches the addon"
```

---

### Task 8: Installing it, and saying so

**Files:**
- Modify: `make/books.mk` (`install`, `package`)
- Modify: `docs/books/README.md`, `docs/books/AGENTS.md`
- Modify: `README.md` (the addon table's status)
- Create: `addons/SpokenBooks/README.md`

- [ ] **Step 1: Add `install` and `package` targets, following `make/zones.mk`**

- [ ] **Step 2: Install into a real client and read a book**

The one test no harness can run: open a book in game, hear it read, turn the page, close the frame. Try a letter, a plaque, and the twenty-page Jitters' Completed Journal.

- [ ] **Step 3: Write the prose and commit**

```bash
git add addons/SpokenBooks/README.md docs/books README.md make/books.mk
git commit -m "SpokenBooks can be installed, and the docs say how"
```

---

## What this plan does not cover

Phase 4: the sound-pack zip, its CurseForge project page, the release workflow entry, and the `push`/`pull` targets that move ~480 MB of narration between this machine and the droplet. Those need the narration finished, which it is not yet.

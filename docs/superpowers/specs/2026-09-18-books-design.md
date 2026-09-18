# SpokenBooks: reading books, letters and notes

## The problem

`README.md` has listed **SpokenBooks** as planned since the merge. The words it would
speak are the one part of WoW's text that no file on disk contains: page text is
server-side in every lineage, vanilla through retail. The client receives it only when a
player interacts with the object or opens the item.

That was worth establishing before designing anything, because it rules out the two
obvious sources:

- **Client data is out.** `WoWDBDefs` has no `Book` or `PageText` table in any build;
  the only related definition is `PageTextMaterial.dbd`, which describes the frame art.
  Confirmed against the definition set, not from memory. The WoW: Forever beta client
  (codename Camelot, mainline-lineage) is no different, and wago.tools carries no
  `1.60.x` build to check against in any case — its `wow_classic_beta` product tops out
  at `5.5.0`.
- **Wowhead is out.** Its listviews scrape cleanly (`/classic/objects/containers/book`
  returns ids and names as JSON), but object detail pages carry no page text. Wowhead
  never stored it.

What does contain it, with ids, is the vmangos world database — the same dump
`pipelines/quests/tts_cli/init_db.py` already downloads and loads for the quests corpus.

## The shape

```
vmangos world DB  ──extract──▶  book_line  ⇄  /books explorer edits
                                    │
                                    ├──export──▶  addons/SpokenBooks/Data/*.lua (committed)
                                    │                      ↓
                                    │             addon build, package
                                    └──generate──▶ take (source='books') + shared/books/
```

The table is the authority and the Lua is an export of it, exactly as
`pipelines/zones/tools/lore/export.mjs` does for zone lore. That keeps the release path
free of Postgres: the addon and its sound pack build on a clone with no database.

## Scope

Decided with the project owner, and deliberately narrower than it could be:

- **Both owner kinds.** GameObject books, plaques and signs (`gameobject_template`
  type 9) and readable items — letters, notes, scrolls (`item_template.page_text`).
- **Vanilla text only.** The vmangos dump is the whole corpus. WoW: Forever is a
  Classic+ fork, so the large majority of its books are vanilla books with unchanged
  text, and the runtime lookup matches on text rather than id — those play with no extra
  work. Forever-only books are a known, accepted gap. No capture addon, no wiki scrape;
  the size of that gap is worth measuring before spending code on it.
- **Three clients:** Classic Era 1.15.x, Anniversary 2.5.x, Forever 1.60.
- **`enUS` only to start.** `locales_page_text` carries eight translations on the same
  ids, so the `lang` column is here at full strength from the first migration.

## Decisions

**One page is one line; one book is a playlist.** `ItemTextFrame` renders a single page,
so per-page ids are what the addon can actually match against what is on screen. Opening
the first page queues the whole chain, so a long book reads straight through, and turning
a page re-syncs the queue rather than restarting it.

**Ids are frozen on first release**, per `AGENTS.md`:

| | |
|---|---|
| line id | `b:{pageTextID}` |
| audio file | `books/{pageTextID}`, extension-less |

vmangos page ids are server-authoritative and never renumber. One file per line follows
the zones rule rather than the quests one: a book page is spoken by one narrator, so
nothing is shared between lines and nothing has to be keyed by text hash.

**The corpus is a table, not a committed file.** This is a deliberate exception to the
rule `migrations/0022_lore_line.sql` writes down — extracted text is a file, written text
is a table. Book text is extracted, so the rule points at a file. It is a table anyway,
at the owner's direction: the reviewing and correcting workflow is the zones one, and
having the history and the edit path there from the start is worth more than the
consistency. A re-extract records a new version and promotes it only when the current
version is itself `extracted`, so re-running the extract can never discard an edit.

**Mail is excluded at runtime.** `ItemTextFrame` serves mail as well as books. A letter
with a creator, or the frame opened underneath `MailFrame`, is skipped — otherwise the
addon would try to speak the player's own mail.

**The lookup ships ids, not words.** Title (`ItemTextGetItem()`) → page number
(`ItemTextGetPage()`) → a cheap Lua checksum of the visible text → lineId. The checksum
earns its place: objects `179547` and `179548` are both named "A Dusty Tome" and hold
different text, so title and page alone collide. Shipping the full page text as table
keys would inflate the data module for nothing, because the addon never needs the words.

**One narrator voice**, as zones has, rather than per-material or per-creator voices.

**Everything runs locally until the UI is ready.** OrbStack runs both databases; nothing
in this work touches the droplet, and the two live sites stay frozen per `AGENTS.md`.

## Components

### `pipelines/books/` — TypeScript, Node

A new pipeline rather than a subcommand of the Python quests one, because both pipelines
are scheduled to merge onto TypeScript and this is new code. It reuses the quests
`docker-compose.yml` MySQL so one vmangos dump serves both.

- **`extract`** — walks `page_text` chains via `next_page`, resolves each chain's owners
  from `gameobject_template` (type 9, `data0` = first page) and `item_template.page_text`,
  and takes the title from the owner's name and the material from `page_material`. Pages
  reachable from no owner are dropped and counted rather than silently discarded.
- **`import`** — upserts into `book_line` with the versioning rule above.
- **`export`** — writes `addons/SpokenBooks/Data/*.lua`, committed.
- **`generate` / `build` / `package-audio`** — mirror the zones voice tools, writing
  `take` rows with `source = 'books'` into the audio store at `shared/books/`.

### `apps/web/migrations/0026_book_line.sql`

Shaped on `lore_line`: `lineId`, `lang`, `version`, `isCurrent`, `origin`
(`extracted` | `edited`), `editedBy`, `note`, `createdAt`, with a partial unique index
giving one live row per `lineId` + `lang`.

The structural fields ride along because the Lua export has nothing else to read:
`pageId`, `bookId` (the chain's first page), `pageNumber`, `pageCount`, `title`,
`ownerKind` (`object` | `item`), `ownerIds`, `material`, `text`, `generatable`,
`skipReason`. As in `lore_line`, they are copied forward on an edit rather than accepted
from the caller — which pages exist is the extract's business, not an editor's.

Additive and forward-only, per `deploy/quests/bin/migrate.sh`.

### `/books` — the site section

`apps/web/src/app/books/` and `components/books/`, following the zones Explorer:
facets for owner kind, material, title and page count; search over page text; the shared
player; report and regenerate wired to the existing queue with `source = 'books'`. Pages
are listed in chain order under their book's title, not as thousands of loose rows.

### `addons/SpokenBooks`

TOC variants for Vanilla, Anniversary and Forever. Queues through `SpokenPlayer` like the
other two feature addons; audio ships separately as `SpokenBooksAudio`.

The runtime API is identical on all three targets — verified against the `classic_era`,
`classic_anniversary` and `forever` branches of `Gethe/wow-ui-source`:
`ITEM_TEXT_BEGIN` / `ITEM_TEXT_READY` / `ITEM_TEXT_CLOSED`, `ItemTextGetText()`,
`ItemTextGetItem()`, `ItemTextGetPage()`, `ItemTextHasNextPage()`, `ItemTextGetMaterial()`,
`ItemTextGetCreator()`. Forever additionally has `ItemTextNextPage`, `ItemTextPrevPage`
and `ItemTextIsFullPage`. One code path, no per-client shims.

### `make/books.mk`

`books-db`, `books-extract`, `books-import`, `books-export`, `books-generate`,
`books-build`, `books-package-audio`, `books-install`, dispatched by the root Makefile.
A separate file because `AGENTS.md` forbids merging the Makefiles, and because several of
these targets will grow `rsync --delete` guards of their own.

## Order of work

1. Pipeline, migration, corpus loaded locally — which is also the first time the real
   counts are known.
2. The `/books` section. **Reported here**, so review and voiceline generation can start
   while the addon is built.
3. The addon.
4. Release scripts and sound-pack packaging.

## Testing

- Pipeline: extract fixtures for a multi-page chain, a chain owned by several objects, an
  item letter, and an orphaned page; the versioning rule gets the tests `recordScrape`
  has — a re-extract over an edited line records without promoting.
- Site: `catalogue`/`search` tests in the shape of the zones ones.
- Addon: `tests/lua/` covers the lookup (including the "A Dusty Tome" collision), the
  mail exclusion, and playlist sync on page turn.

## Not doing

- Forever-only book capture. Measured first, built only if the gap is worth it.
- Translations. The schema allows them; nothing produces them yet.
- Per-material or per-creator voices.

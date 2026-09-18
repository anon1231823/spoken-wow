# Books

Every book, letter, note and plaque World of Warcraft will show you, extracted from the
vmangos world database, reviewable at `/books` on the site, and — once the addon exists —
read aloud in game by **SpokenBooks**.

## Where the words come from, and why not from anywhere else

Page text is the one part of WoW's text that no file on disk contains. The client receives
it from the server when you interact with the object or open the item, and it is never
shipped in the game data. Two things follow, and both were checked rather than assumed:

- **Client data has none of it.** `WoWDBDefs` defines no `Book` or `PageText` table in any
  build, in any lineage, vanilla through retail. The only related definition is
  `PageTextMaterial`, which describes the frame the client draws around the words. The
  WoW: Forever beta client (codename Camelot) is mainline-lineage and no different.
- **Wowhead has none of it either.** Its listviews scrape cleanly — `/classic/objects/
  containers/book` returns ids and names as JSON — but the object pages carry no page text.
  Wowhead never stored it.

What does have it, with ids and eight translations, is the **vmangos world database**: the
same dump `pipelines/quests` already downloads and loads for the quest corpus.

| Table | What it holds |
|---|---|
| `page_text` | `entry`, `text`, `next_page` — the pages, as a linked list |
| `locales_page_text` | the same pages in eight other languages, on the same ids |
| `gameobject_template` | type 9 is a book, plaque or sign; `data0` is its first page |
| `item_template` | `page_text`, `page_language`, `page_material` — letters, notes, scrolls |

## What is in the corpus

From the 1.12 patch rows of one dump:

- **1191 pages** across **404 books**, under **381 distinct titles**
- **743 pages** are carried items — letters, notes, scrolls. **448** are objects in the world.
- **66 pages** are orphaned: page text for content that was cut, which nothing can open.
- **1 page** is claimed by two chains, and belongs to the one with the lower first page.
- **88 pages** cannot be voiced — 36 hold substitution tokens the client fills in at
  runtime, 26 are empty, 26 say "Missing Text". They stay in the corpus, labelled: the game
  has them, and a corpus that dropped them would look like it had missed them.

That leaves **1103 voiceable pages, 385,631 characters**.

Vanilla only. WoW: Forever is a Classic+ fork, so most of its books are vanilla books with
unchanged text, and the addon matches on the text rather than on an id — those play with no
extra work. Forever-only books are a known gap, to be measured before anything is built for
them.

## The stages

| Stage | Input | Output | Who runs it |
| --- | --- | --- | --- |
| `extract` | vmangos world DB | `pipelines/books/corpus/extract.json` | a maintainer, after a dump refresh |
| `import` | that file | `book_line` rows | the same maintainer |
| review | `book_line` | corrected text | anyone, at `/books` |
| generate | `book_line` | mp3s and `take` rows | anyone with an ElevenLabs key |
| export | `book_line` | `addons/SpokenBooks/Data/*.lua` | *not built yet — phase 3* |

## Running it locally

The databases are OrbStack containers and a native Postgres. Nothing here touches the
droplet.

```bash
orb start
make books-db                 # the vmangos MySQL, which pipelines/quests provisions
make books-extract            # -> pipelines/books/corpus/extract.json
DATABASE_URL='postgres://localhost/spoken_quests_dev' make books-import
pnpm --filter @spoken/web dev # /books
```

The extract connects with `BOOKS_MYSQL_HOST`, `BOOKS_MYSQL_PORT`, `BOOKS_MYSQL_USER`,
`BOOKS_MYSQL_PASSWORD` and `BOOKS_MYSQL_DATABASE`, defaulting to the quests
`docker-compose.yml` values. The prefix is not decoration: a bare `MYSQL_PASSWORD` exported
by some other project turns this into an access-denied error that reads exactly like a dump
that was never loaded, which is a afternoon nobody needs twice.

If the dump has never been loaded on this machine, the quests pipeline's bootstrap does it
— it fetches vmangos `db_latest` and loads `mangos.sql`. Once, and slowly.

## Re-importing is safe

A re-import records a new version of a page and promotes it only when the live version is
itself `extracted`. A hand-corrected page keeps its correction until somebody promotes the
new text from the history. Identical text is not recorded at all, so version numbers count
changes rather than imports.

Structure is different, and moves in place: which book a page belongs to, its number, its
title and its owners are facts about the world rather than content, so the import corrects
them on the live row — on edited pages too. Without that, a page could only be re-placed by
changing its wording as well, and one page did move between books without a word changing.

## Tests

```bash
make books-test                    # the pipeline: text, naming, chains, promotion
pnpm --filter @spoken/web test     # the site, including lib/books
```

## The addon

`addons/SpokenBooks` hooks `ITEM_TEXT_BEGIN` / `READY` / `CLOSED` — the whole book UI, and
the same API on Era, Anniversary and Forever, which is why there is one addon rather than
three.

**A page is identified by what is on screen**, because the client never says which page id
it is showing. Title, page number and a checksum of the text; then the checksum alone,
where no other page shares it; then nothing. Nothing is the right third answer: the
alternative is reading the wrong page's words aloud.

**The checksum is the load-bearing part.** `pipelines/books/tools/lib/naming.mjs` and
`addons/SpokenBooks/Checksum.lua` must produce the same number for the same text, over
UTF-8 bytes, using only multiply, add and modulo — the clients run Lua 5.1, which has no
bitwise operators. `tests/lua/books_source_test.lua` asserts the two agree, on an ASCII
string and an accented one. They have to: the lookup is keyed on that number, and a
disagreement makes every page unfindable, silently.

**Mail is excluded twice.** `ItemTextFrame` serves mail as well as books, so a letter with
a creator is skipped, and so is anything shown while `MailFrame` is open — which catches
the mail that has no creator, like a returned letter.

**A book is queued whole.** Opening page one queues to the end, so a journal reads on while
you turn pages; turning to a queued page changes nothing, and turning elsewhere rebuilds
from there. The source has no queue limit, unlike zones: a cap trims the oldest waiting
clip, which on a four-page book keeps the first page and the last and discards the middle.

**Two saved-variable tables, on purpose.** `SpokenBooksDB` is account-wide and holds the
three switches — autoplay, whole-book, read-once. `SpokenBooksCharDB` is per character and
holds only what that character has been read, keyed by book id. Settings are how you like
the addon to behave; having read something is a thing a character did, so an alt walking
into the same library hears it fresh.

**Read-once marks a book when narration starts, not when it ends.** The addon is never told
that a clip finished — the player owns the queue — so "finished" could only be inferred
from a queue that `/spb stop` or a zone change can empty early. The rule refuses autoplay
only: `/spb read` and the Play button go straight to the playlist, because a reader pressing
play has asked again in so many words. It also does not refuse the book it is in the middle
of reading, which is what `SpokenBooks:IsNarrating` is for — a reader who jumps past the
queued pages would otherwise strand the narration on the page they turned away from.

**The panel and the button are the two files this addon reads books without.**
`UI/Options.lua` registers a settings canvas the way the zones panel does, and
`UI/PlayButton.lua` hangs Play/Stop off the book window — outside its top-right corner,
because the inside of `ItemTextFrame` is Blizzard's and its art changes with the page's
material. `Events.lua` guards both calls, so a partial install still narrates. Every switch
on the panel is also a `/spb` command, which is what a client with no Settings API gets.

`UI/Layout.lua` is the fourth copy of a file that must stay byte-identical across
SpokenPlayer, SpokenQuests, SpokenZones and SpokenBooks;
`pipelines/quests/tests/test_package.py` is what enforces that.

### Installing it in a client

```bash
make books-deploy                  # symlink into Classic Era
CLIENT=forever make books-deploy   # or the Forever beta (wow_classic_beta)
make books-status                  # what is installed where, and how many mp3s exist
```

## Releasing

The two CurseForge projects:

| Project | id | Slug |
| --- | --- | --- |
| Spoken Books | 1701514 | `spoken-books` |
| Spoken Books Audio | 1701520 | `spoken-books-audio` |

There is no `scripts/books/release.sh` yet. When there is, those ids belong in its
`target_project()` the way the quests and zones ones do — and an unknown target must fail
rather than default, for the reason `docs/quests/CLAUDE.md` gives: an id left in that
function is an id something eventually uploads to, and uploading a books pack over another
project is not recoverable from this side.

The project pages themselves are `curseforge/books/*.md`; paste
`dist/descriptions/<slug>.md` after `make descriptions`, then record it with
`make descriptions-published`.

# AGENTS.md — the books side

Repo-wide conventions are in the root `AGENTS.md` and still apply. These are this side's.

## Frozen, like every other id in this repo

- A line id is `b:{pageTextID}` and an audio file is `{pageTextID}`, extension-less,
  relative to the books store.
- `pipelines/books/tools/lib/naming.mjs` owns both and nothing else derives either.
- vmangos page ids are server-authoritative and do not renumber, which is why they are safe
  to freeze.

## The table is the corpus; the Lua is an export of it

`book_line` is what the site reads and what an editor changes. The addon's
`Data/Books.lua` is generated from this table and committed, so the addon and its sound pack
still build on a clone with no Postgres. Nothing on the site may read those files: it would
show whatever was last exported rather than what the table says.

This is a deliberate exception to the rule migration `0022_lore_line.sql` states — extracted
text is a committed file, written text is a table. The reasoning is in `0026_book_line.sql`.

## The extract must respect `patch`

`gameobject_template` and `item_template` hold one row per content patch, and the server
serves `max(patch)` at or below the patch it runs (vmangos `ObjectMgr.cpp:8143`, `:3820`).
A query without that window returns an object under every name it has ever had. `page_text`
has no patch column, which is why it is selected plainly.

## The checksum constants are load-bearing

`pageChecksum` in `naming.mjs` is recomputed by the addon in Lua, over **UTF-8 bytes**,
using only multiply, add and modulo. Changing `CHECKSUM_MODULUS` or `CHECKSUM_FACTOR` means
re-exporting the addon's data module, because its lookup tables are keyed on the result.
It exists because a title and a page number do not identify a page: objects 179547 and
179548 are both named "A Dusty Tome" and hold different text.

## One page is one entry

A page belongs to exactly one book. Where two chains run into the same page — vmangos has
one such case — the chain with the lower first page keeps it and the other is counted in
`shared`. Chains are walked in sorted order so that choice comes from the data rather than
from the order MySQL returned the owners in.

## Mail is not a book

`ItemTextFrame` serves mail as well as books. A letter with a
creator, or the frame opened underneath `MailFrame`, is skipped — otherwise it reads
the player's own post aloud.

## The droplet's copy of Sounds.lua is ephemeral

When the queue drains, the site rebuilds `addons/SpokenBooksAudio/Data/Sounds.lua` -- but
inside the release directory it is running from, which is deleted five deploys later. That
write is what keeps a take reachable if anybody reads the file from that release; it is not
what ships.

What ships is the committed one. Before cutting a sound pack, bring the takes and the
narration home and regenerate it here:

```bash
make books-sync        # the droplet's page text and takes -> local database
make books-lookup      # -> addons/SpokenBooksAudio/Data/Sounds.lua (committed)
make books-pull-history  # every take -> pipelines/books/audio-history
make books-sounds      # the live takes -> addons/SpokenBooksAudio/Sounds (not committed)
```

The zones side has the same arrangement for the same reason.

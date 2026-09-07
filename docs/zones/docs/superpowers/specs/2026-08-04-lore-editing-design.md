# Editing lore text in the explorer

## The problem

The explorer could tell you a line was wrong and do nothing about it. It could flag the
line, collect visitor reports on it, and spend ElevenLabs credits speaking it again — but
the words themselves came from `addon/ZoneLore/Data/*.lua`, generated from the wiki by
`tools/scrape.mjs` and `tools/scrape-subzones.mjs`. Text was a build input, not state.

The hand-editing path that did exist covered zones only: `tools/seed/overrides.json` is
keyed by uiMapID and read by `tools/scrape.mjs` alone. Subzones — 1304 of the 1353 lines —
had no supported edit path at all. Fixing one meant editing a generated file that
`AGENTS.md` forbids editing.

## The shape

The corpus moves into Postgres as `lore_line`, versioned the way `voiceline_take` is. The
Lua data files stay committed and become an *export* of that table.

```
wiki cache → tools/lore/import.mjs → lore_line ⇄ explorer edits
                                        ↓ tools/lore/export.mjs
                          Zones.lua + Subzones.lua (committed)
                                        ↓
                    buildCatalogue() → addon build, generate.mjs, validate
```

Everything downstream of the Lua is untouched, which is what keeps the release path free
of Postgres: `make package`, `make check` and `make validate-audio` still run on a clone
with no database. Migration `0001` states that requirement for the manifest; this holds
the same bargain for the text.

### Decisions

**All lines live in the table, not just edits.** An override layer would have been
smaller, but it makes "what does this line say" a two-source question forever. Seeding the
whole corpus means the export can be written from the table alone.

**A re-scrape records, and only sometimes promotes.** A scraped version is always
inserted, so upstream movement stays visible. It becomes live only when the current
version is itself `scraped`; a hand-edited line keeps its edit until a person promotes the
new text from the history. Without this, `node tools/scrape.mjs` is a command that
silently discards work, and therefore one nobody dares run. Identical text is not recorded
at all, so version numbers count changes rather than scrapes.

**A row carries the whole exportable entry** — `name`, `short`, `full`, `source`, plus the
structural `mapID`/`kind`/`key`. `short` is re-derived by `makeShort()` on save unless
`shortIsManual` records that somebody wrote one deliberately. The structural fields are
copied from the previous version on save rather than accepted from the caller: which
subzones exist is the scraper's business, and an API that let a text edit move a line to
another uiMapID would be one bad request from a line the addon can never look up.

**`source` doubles as the licence marker.** Wiki text is CC BY-SA 4.0, and an edit of wiki
text is a derivative, so the source rides along with the edit. Only prose with no wiki
ancestor has no source. The Lua headers now attribute per entry instead of claiming CC
BY-SA for the whole file.

**Editor and admin may edit.** Same bar as flagging and regenerating: one line, fully
reversible through the history. The lexicon stays admin-only because a pronunciation rule
is global and changes what the next regeneration pass costs.

**Editing never regenerates.** The new text hashes differently from what was spoken, so
the line reads "text changed" and joins the regeneration worklist like any other stale
line. Coupling a free action to a paid one is how a typo fix costs credits.

### The catalogue overlay

`web/src/lib/catalogue.ts` builds from the Lua as before, then lays the live `lore_line`
rows over the top, recomputing `spoken` and `hash` for any line whose text moved. This
keeps `tools/` database-free while making an edit visible immediately rather than after an
export, a commit and a deploy. An unseeded table is empty and the overlay is a no-op, so
the app behaves exactly as it did before `make lore-import` is first run.

The catalogue is memoised on `globalThis`, so saving an edit calls `invalidateCatalogue()`.

## Surfaces

| Piece | What it does |
|---|---|
| `web/migrations/0005_lore_line.sql` | The table, with a partial unique index enforcing one live version per line |
| `tools/lore/lua.mjs` | The two emitters, lifted out of the scrapers so both paths share them |
| `tools/lore/store.mjs` | The seam: database when `DATABASE_URL` is set, Lua files when it is not |
| `tools/lore/import.mjs` | Seeds the table from the committed Lua. Never overwrites an existing line |
| `tools/lore/export.mjs` | Writes both data files. `--check` asks whether they are in step |
| `web/src/lib/lore.ts` | Read, save (optimistic concurrency), restore |
| `web/src/app/api/lore/route.ts` | GET history, PUT a rewrite, POST a restore |
| `web/src/components/LoreDialog.tsx` | The editor, with the version list and per-version restore |
| `make lore-import` / `lore-export` / `lore-check` | The traffic between table and files |

`lore_line` joins `DUMP_TABLES`, so `make db-push` / `make db-pull` carry it.

## Verification

The migration's own correctness test is a round trip: seed from the committed Lua, export,
and diff. Result: all 1353 entries reproduce byte-for-byte, the only change being the two
file headers, which were rewritten deliberately.

Behaviours confirmed against the local database:

- a scraped-current line takes new wiki text (`promoted: 1`)
- an edited line holds it back (`heldBack: 1`, edit stays live, wiki text recorded beneath)
- re-running an unchanged scrape records nothing (`unchanged: 1`)
- an edit makes `lore-check` fail, and `lore-export` produces a diff confined to that entry

`make check` and `pnpm build` pass. There is no test framework in this repo; `make check`
is the gate.

## Not in scope

The Deathknell rewrite that prompted this. It is content, not tooling: it goes through the
new UI, bumps `ZoneLore`'s version and writes a changelog entry. This change is invisible
to players and bumps nothing.

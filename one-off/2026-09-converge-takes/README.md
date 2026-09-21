# 2026-09: the archive becomes the only audio

**Run once, before deploying PR #29. Not to be run again.** See `../README.md`.

## What changed

Before, each section kept a *store*: one file per line, overwritten with whichever take was
live (`shared/audio/`, `shared/sounds/`, `shared/books/`), and an *archive* of earlier takes
beside it (`shared/audio-history/`). Changing the live take meant rewriting files, and a
restore on zones and books could destroy the only copy of a take.

After, every take is one file in the archive, written once and never changed, and which take
is live is a flag on its row. The site plays the live take's archived file; a sound pack is
built by copying the live takes out of the archive (`scripts/audio/sounds.mjs`). The stores
are left where they are, untouched, so a rollback still finds its audio; a later cleanup may
remove them.

## What this does, in order

`run.sh` does all of it from a laptop, at the commit about to be deployed, and asks before
every step that writes:

1. **Migrations** 0031 and 0032, applied ahead of the deploy. Both only add, so the release
   still serving runs against them unchanged.
2. **`import-corpus`**: the quests corpus into `quest_line`, so the new release finds it.
3. **A listing of production's `shared/`**: every mp3 under the three stores and the archive,
   with its size. The only way the next two steps see the disk.
4. **`rebuild-takes.mjs`**: the take table records every take that happened.
   - Quests: the old code pruned takes, deleting rows and files together, oldest first, and
     started numbering at 0. Every file's takes become the union of the archive's numbers and
     the rows' numbers, renumbered from 1, each pointing at its archived clip.
   - Zones and books: every row is pointed at its archived clip, matched by size, where it has
     one. Some clips were consumed by the old rename-to-restore and are gone.
5. **`adopt-store.sh`**, on the droplet: every live take that only a store holds is hard-linked
   into the archive under the name the site gives a take it cuts, and its row records it.

Then deploy. **Cut no take on the site between step 4 and the deploy going live**: the
release still serving numbers takes the old way.

## Rehearsal

Rehearsed against `spoken_prod_rehearsal`, a copy of production's database, with a listing of
production's archive (the step-5 file side needs the droplet and was only listed):

- Quests: 22,994 takes, 22,946 with an archived clip; 11,190 live, 47 of them only in the store.
- Zones: 2,510 takes; 1,159 pinned by size, 855 live only in the store, 496 whose clip is gone.
- Books: 1,107 takes; 4 pinned, 1,103 live only in the store.

Before step 5, 2,005 live takes (1,103 books, 855 zones, 47 quests) had no archived file.

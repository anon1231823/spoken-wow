# VoiceOver for World of Warcraft

### [voiceline explorer: voiceover.rusty.one](https://voiceover.rusty.one)
### [voiceover discord](https://discord.gg/VdhUmA8ZCt)

## Overview

A pipeline for producing AI voiceovers for WoW Classic dialog. The sound pack and the addon
data module are build outputs of this project.

Every line the project knows about is browsable, playable and — for signed-in collaborators —
re-voiceable at [voiceover.rusty.one](https://voiceover.rusty.one), which is the `web/`
directory of this repo running against the same corpus and audio store the CLI produces.

Five stages, and only the first needs a database:

| Stage | Input | Output | Who runs it |
| --- | --- | --- | --- |
| `extract` | vmangos world DB | `corpus/corpus.json.gz` | a maintainer, when vmangos ships a new dump |
| `import-audio` | an existing sound pack | `audio/` | once, to adopt audio you already have |
| `synthesize` | corpus + voice config | mp3s in `audio/` | anyone producing lines |
| `build` | corpus + `audio/` | `dist/AI_VoiceOverData_Vanilla/` | anyone cutting a release |
| `install` | the built module | WoW AddOns folder | to try it in game |

The corpus is **committed** — 17,507 lines, 2 MB gzipped — so producing audio needs no
database, no dump, and no Docker.

## Below is for developers only. Go to [releases](https://github.com/mrthinger/wow-voiceover/releases) if youre looking to install the addon.

## Requirements

- Python 3.10+ — the pipeline
- Node 24 and pnpm — **only** to run the web explorer locally
- Docker — the vmangos MySQL when refreshing the corpus, and the explorer's Postgres

## Installation

1. Create and activate a virtual environment:
```bash
python -m venv .venv && source .venv/bin/activate
```
2. Install the everyday dependencies — five pure-Python packages, no compiled extensions
   and no database client:
```bash
pip install -r requirements.txt
```
3. Copy `.env.example` to `.env` and fill in your ElevenLabs API key:
```bash
cp .env.example .env
```

That's it. The committed corpus already contains every line's text, voice and metadata.

## Refreshing the corpus

Only needed when vmangos publishes a new database dump, or when the extraction needs a
column it didn't previously capture.

```bash
pip install -r requirements-extract.txt   # adds pandas, numpy, PyMySQL
docker compose up -d mysql                # the vmangos world DB
python cli-main.py init-db                # download and import the vmangos dump
python cli-main.py extract                # writes corpus/corpus.json.gz
```

Commit the resulting corpus; the diff is reviewable.

## Voice Setup

Generation resolves a voice by *name*, so your ElevenLabs account must hold voices named
`race-gender-flavor` — `orc-male-shady`, `nightelf-female-priestess`, `dwarf-male-grim`.
Stock library voices are ignored: their names cannot express that mapping.

**The flavor is which of a race and gender's several voices an NPC actually speaks with.**
Every playable race-gender has two or three distinct NPC voice sets recorded by different
actors — nightelf-male is standard, warrior and official; orc-female is standard, shaman and
warrior. The game chooses per NPC through its display info, and `tts_cli/flavors.py` recovers
that choice from the SoundEntries names, falling back to the race-gender's commonest set when
the game data does not answer. The corpus carries the result, so the current corpus needs 54
voices rather than one per race-gender. `narrator-male` is the exception and has no flavor:
it is a pseudo-race for gameobjects and items.

The whole set is listed on `/voices`, which is also the easiest way to build it — see
"Managing voices". The clips to build them from are Blizzard's own NPC greeting barks:

```bash
python tools/fetch_npc_lines.py          # into voice/npc-lines/<race-gender>/<flavor>/
```

That directory is gitignored and local-only. It is Blizzard's audio, and it is input to a
pipeline rather than something to redistribute.

## Usage

```bash
python cli-main.py --help
```

Selecting what to voice used to mean dragging a rectangle over a map image, which filtered
NPCs by world coordinates. That picker is gone — selection is now a filter over the corpus,
by NPC, quest, or spawn area. Spawn positions are carried in the corpus, so area selection
still works with no GUI and no database:

```python
from tts_cli.corpus import load_corpus, lines_in_area

corpus = load_corpus()
elwynn = lines_in_area(corpus, map_id=0, x_range=(-9900, -9000), y_range=(-600, 900))
```

### Producing a data module

```bash
python cli-main.py import-audio                       # adopt an existing pack, once
python cli-main.py synthesize --npc 240 --dry-run     # what would be made, and its cost
python cli-main.py synthesize --npc 240               # make it
python cli-main.py build                              # dist/AI_VoiceOverData_Vanilla/
python cli-main.py install --force                    # into the AddOns folder
```

`build` emits the sounds, every lookup table and a `sound_length_table.lua` computed from
the mp3s it just copied. The addon resolves sounds through that table rather than the
filesystem, so building the two together is what stops a line going silent.

`install` moves any existing install aside to `<module>.replaced` rather than deleting it.

### Browsing the corpus

Nothing in a filename identifies an NPC — quest audio is `{questID}-{accept|complete}.mp3`
and gossip audio is a content hash — so an NPC's lines are scattered across ~9,500 files
with no shared key. The web explorer reassembles that view. It is deployed at
[voiceover.rusty.one](https://voiceover.rusty.one); to run it locally:

```bash
docker compose up -d postgres          # the app's own database
cd web && pnpm install && cp .env.example .env.local && cd ..
export DATABASE_URL=postgres://voiceover:voiceover@127.0.0.1:5432/voiceover
deploy/bin/migrate.sh "$PWD/web"       # every migration, in order
cd web && pnpm dev                     # http://localhost:3000
```

Apply migrations with that script rather than by hand: it is what the droplet and CI run, so
a migration that only works under an improvised `psql` fails here instead of mid-deploy. It
reads `DATABASE_URL` from the environment, which `.env.local` does not export.

Search by NPC name or id, or quest title or id, and play any line in the browser. The corpus
and the audio store are read straight off disk; the corpus is never written. Postgres holds
what the corpus cannot: accounts and roles, the take history behind each regeneration, the
pronunciation lexicon, hand-written line overrides, the scan's findings and the regeneration
queue. Run `import-audio` first, or every line shows as a gap.

Lines with no audio are marked. `no audio` is a real gap; `progress` and `invalid-chars`
are lines the generator deliberately never voices.

#### Accounts and roles

Registration at `/register` is open and needs no email confirmation. Everyone starts as a
**member**, which is the same read-only explorer an anonymous visitor gets.

| Role | Can |
|---|---|
| `member` | browse and play, like a signed-out visitor |
| `collaborator` | the above, plus **Regenerate** on every line, quest and NPC, the take history behind each, and rewriting what a line says out loud |
| `admin` | the above, plus `/admin` to change anyone's role, `/voices` to manage voices and the global generation settings, `/lexicon` to correct how names are pronounced, and `/issues` to work through what the corpus scan found |

#### Regenerating audio

A line, a quest or a whole NPC can be re-voiced from the explorer. A single line is
regenerated directly — one click, one answer. Anything larger goes through a queue.

**A batch is rows in Postgres, not a loop in a tab.** Starting one posts the *filters* rather
than a job list, and the server re-derives the same line set the search ran, so a
forty-thousand-line batch is a small request. Closing the tab, reloading, losing the network
or deploying mid-batch changes nothing: the jobs are still there, and whichever process holds
the queue's Postgres advisory lock keeps draining them. That leader is one of the pm2 workers,
elected rather than configured, and a `pm2 reload` is a handover — the outgoing leader
finishes what is in flight before it lets go.

**It runs several at a time.** Concurrency comes from what the ElevenLabs plan allows for the
model in force, minus one slot held back so the single-line button and the `/lexicon` previews
are never starved by a running batch. A rate limit halves the budget for a minute rather than
retrying into a wall; a rate-limited job backs off with jitter and is retried three times
before it fails. A *fatal* error — quota, a bad key, a missing voice — fails the job and
cancels the rest of the batch in the same statement, because those fail every remaining line
identically.

**The panel is global.** It shows counts by state, the real summed credits, the failures and
whatever another admin started, since the budget being spent is the same account's. **Stop**
cancels everything pending and lets the in-flight requests finish: those characters are billed
already, so throwing away the audio would pay for nothing.

**Nothing is generated twice.** A partial unique index on the file rejects a job for an mp3
already pending or running, and the panel reports how many it skipped rather than hiding them.

**Regeneration replaces a file, not a line.** 1,076 files are spoken by more than one NPC —
a gossip file is named `md5(text + race + gender)` — so every NPC sharing a line hears the
change, and a batch generates each file once however many lines point at it.

**Every take is kept.** Before the first regeneration overwrites a file, whatever was there
is archived as version 0, and the history popover on the line plays and restores any take.
Version 0 is never pruned: it is audio that predates this project's ability to reproduce it,
and losing that is exactly how the project ended up with voices it could not remake. The
newest four are kept alongside it.

**What it costs.** ElevenLabs does not bill the characters you send; it bills
`characters × rate`, where the rate belongs to your plan — 0.55 on a Creator account, half
that for the flash and turbo models. So the confirm dialog before a batch estimates from
what your account has actually been charged, and every response reports its exact cost, which
the panel sums as it runs. Until there is anything to calibrate from it shows the list rate
as an upper bound and says so.

Settings — model, stability, similarity, style, seed strategy — are global and live on
`/voices`, admin-only. They override `voice/generation.json`, which stays what the Python CLI
reads, so the two can drift; the page shows which is in force.

#### Pronunciation

`/lexicon` is admin-only, and holds the names a text-to-speech reader gets wrong — Gnomeregan
with its silent G, Kel'Thuzad, Cairne, and the 131 others it starts with. Saving
uploads them to ElevenLabs as a pronunciation dictionary and pins every later request to that
exact version.

Every entry is one row, edited in place: the pencil turns its cells into fields of the same
width, and the checkbox in the OK column records that somebody has listened. The All / OK /
Not OK filter is how you find the ones still to be checked.

**You do not need IPA.** An entry gives either an IPA pronunciation or a plain respelling —
`nomeregan` — and the `ʒ` button switches between the two in one click; the slashes around an
IPA field are drawn by the editor, and never part of the value. The trade is exactness
against reach: IPA becomes a phoneme rule, which is precise but honoured only by `eleven_v3`
and `eleven_flash_v2`; a respelling becomes an alias rule, which is only as good as the guess
at the new spelling but works on every model. Both kinds sit in one dictionary, so the lexicon
does not have to pick. When the configured model ignores phoneme rules the page says how many
entries that silently skips, rather than implying the whole page is inert.

Respell it as it should be *said*, not as it should be *read*: `nomeregan`, not
`NOME-reh-gan`. Capitals can be spoken as an acronym and hyphens as pauses; if the
stress-capitals form is worth recording for a reader, it belongs in the entry's note.

**A phoneme rule cannot be case-insensitive.** ElevenLabs discards one carrying
`case_sensitive: false` *silently* — a 200, an id, a version, and the rule simply absent from
the stored dictionary. Alias rules tolerate the same flag, which is what made this so hard to
see. So phoneme rules go up with `case_sensitive: true` — **one rule per spelling, derived, not
typed**. You add `Forsaken` once and the upload carries `Forsaken`, `forsaken` and `FORSAKEN`,
because those are what the corpus contains. 134 entries become 156 rules. Aliases keep
`case_sensitive: false`, where it works, and need no expansion.

Spellings come from two places. Whatever the corpus actually uses is scanned for; and a
lower-case entry additionally gets its capitalised form whether or not one occurs yet, because
`satyr` beginning a sentence is a fact about English rather than about this corpus.

**Every request pins the language to English.** ElevenLabs infers language from the text
otherwise, and a short input gives it almost nothing to go on — a bare name in a word preview
gives it nothing at all, which is how one comes back with the wrong language's vowels.
`language_code` also governs text normalization, so it plausibly decides how a phoneme string
is read. Sent only to models documented as accepting it; omitting is what every request did
before, so a model absent from that list loses nothing.

**Every upload is read back and counted.** Send N rules, download the dictionary, count the
lexemes. A mismatch is shown on the page rather than trusted away — the absence of this check
is why a lexicon that had never applied a single pronunciation reported itself healthy for
weeks.

**Saving does not touch audio already in the store.** Each take records the dictionary version
and a hash of the text it was spoken with, so a line generated before a fix stays playable and
stays identifiable as out of date.

**The lexicon lives in the database, not in the repo.** Unlike the generation settings there
is no file layer at all: migration `0008` carries the 134 starting entries and seeds the
`pronunciation_lexicon` row once, and every change after that is made in the editor. A copy on
disk could only be a stale snapshot competing with the live data — and "reset to the committed
lexicon" would have meant discarding real work to return to whatever that copy said at deploy
time.

The Python CLI sends no dictionary at all — it is the one place the two generators no longer
produce identical audio.

**One dictionary, one id, updated in place.** `ELEVENLABS_DICTIONARY_ID` names it, and a save
brings its rules to whatever the lexicon now holds rather than creating a new dictionary. The
id has to be stable because it is shared: `../wow-lore` narrates a different corpus on the
same ElevenLabs account, gets the same names wrong, and simply writes this id into its
`tools/voice/config.json`. Nothing else crosses between the two projects — no database, no
API, no exported file — and this one is the only place the lexicon is edited.

A save sends *every* rule the lexicon holds and then removes only the strings it no longer
has. `add-rules` replaces a rule matching the same string, so the upload needs no diff, and
adding before removing means there is no instant at which a name still in the lexicon has no
pronunciation. This is why the earlier design — a fresh dictionary per save, to avoid a diff
whose failure mode is an invisible leftover rule — is no longer worth its cost. Versions stay
immutable and every request still pins one, so generation already in flight is untouched.

With the id unset the old behaviour returns: a dictionary is created, and its id is logged as
the value to configure.

#### What the corpus scan found

`tools/scan_corpus_hiccups.py` reads the corpus and writes `corpus/hiccups.json.gz`: every
token or fragment likely to trip a reader up — invented names no pronunciation rule covers,
stage directions in asterisks, Blizzard's own typos, raw binary, alphanumeric codes. The
artifact is committed and ships inside a release; `/issues` → **Reload scan** loads it into
Postgres, and it is never read on the search path. `docs/corpus-hiccups.md` documents the
method and the categories.

**A finding is a detection, not a defect.** `Ashenvale` occurring 199 times is a fact about
the corpus; whether it is a problem depends on the lexicon and on someone having listened. So
the scan does not consult the lexicon — coverage is decided when the findings are loaded, and
a reload replaces every detection while leaving every verdict (`open`, `fixed`,
`dismissed`) alone.

**Some lines cannot be fixed by pronunciation.** `q:1155:accept` is the single letter `x`;
`q:257:complete` says "adventurerama", because Blizzard wrote `$Nama` and the token
substitutes to a fixed word. For those a collaborator rewrites what the line *says*, and the
explorer marks it **rewritten**. An override changes the spoken text only: the filename and
every addon lookup key derive from the original text, so a rewrite can never rename a file or
make the addon miss it. It also reopens the `invalid-chars` gate — stripping a `$` or a `<>`
makes an otherwise unvoiceable line voiceable — while `progress` lines stay skipped, because
that is policy rather than a text defect.

**Audio made before a fix says so.** Every take records a hash of the exact string sent to
ElevenLabs, so a line whose text has since changed — by a rewrite, a pronunciation rule or a
corpus refresh — is marked **text changed** and stays playable until someone regenerates it.
Takes from before that hash existed are reported as fresh rather than guessed at.

Like the lexicon, overrides live only in the database, and the Python CLI does not see them.

#### Managing voices

`/voices` is admin-only. It lists the 54 `race-gender-flavor` voices the corpus needs —
alphabetically, so a race-gender's flavors sit together — with the lines and NPCs each one
carries, and marks which exist in the ElevenLabs account. The list is derived from the corpus
rather than written down, so a race added upstream cannot leave the page quietly missing a
voice.

Expanding one shows the clips it would be cloned from: upload, play back, delete, and
**merge** a selection into one take with an adjustable pause. A slot finds its own source
material in `voice/npc-lines/<race-gender>/<flavor>/`, which is the shape of its name — no
mapping table to keep in sync when a flavor is added. Two slots have nothing to seed from and
that is expected: `narrator-male` is not a race, and `bloodelf-female` is one Sylvanas line
from a later expansion's model.

Merging is there because the practical source is one-second greeting barks.
ElevenLabs treats combined length as what decides clone quality — one to two minutes is the
target, past three it grows unstable — and a pile of one-second files gives the model no
continuity between them. It defaults to deleting the originals, because cloning uploads every
clip in the folder and keeping both would send the same audio twice.

**Create voice** spends one of the account's custom voice slots (30 on Creator, fewer than
the 54 the corpus asks for, so a Creator account cannot hold the full roster at once).
**Replace**
is delete-then-add: ElevenLabs has no re-train call, and two voices sharing a name would make
`fetch_voice_map` ambiguous. The clips stay on disk either way — an ElevenLabs voice cannot
be exported, so they are the only way to remake one. Losing that is precisely why this project
inherited voices it could not reproduce, so `make pull-voices` them somewhere safe.

Merging needs `ffmpeg` on the server. Uploading and cloning do not.

There is no way to create the first admin through the UI, by design. Promote yourself once,
directly against the database, and hand out every later role from `/admin`:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'you@example.com';
```

#### Deploying the explorer

The explorer runs at [voiceover.rusty.one](https://voiceover.rusty.one), on a DigitalOcean
droplet behind nginx. Pushing to `master` builds and ships it automatically — the workflow
typechecks, applies the migrations with the droplet's own script, runs the tests against a
throwaway Postgres, and only then builds and swaps the release. The audio store moves
separately, by hand, because it is 1.1 GB and belongs in neither git nor CI.

```bash
make push            # local audio/ -> droplet, then reload (dry-run + confirm first)
make pull            # droplet -> local audio/  (--delete: removes local extras)
make audio-status    # file count and size on both sides
make releases        # what is deployed, and what you can roll back to
make rollback        # back one release; RELEASE=<name> to pick one
```

**The droplet is usually the newer side now**, because regeneration happens there through
the web UI. `make push` runs two rsync dry runs to find files the droplet has changed since
you last pulled, and refuses rather than let `--delete` take them; `make pull` first, or
`FORCE=1` to overwrite anyway. It no longer needs a pm2 reload — `storeIndex()` re-reads
whenever the store's mtime moves, which is also what lets a line generated by one pm2 worker
be visible to the other.

```bash
make pull-history    # previous takes; v0 of each is unreproducible, so back this up
make history-status
```

Deploys are versioned as directories under `/srv/voiceover/releases/`, with `current` a
symlink that pm2 follows, so a rollback is a symlink swap needing neither CI nor network.
The audio store lives outside every release in `shared/`: it is never copied on deploy and
survives a rollback untouched. Migrations run before the swap and are forward-only — a
rollback restores code, never schema, so every release must run against the schema of the
release after it.

A running batch survives a deploy. The new leader picks up whatever it finds in the queue,
and the outgoing one is given 30 seconds to finish its in-flight generations before pm2 kills
it, which is what `kill_timeout` in `deploy/ecosystem.config.js` is for.

First-time droplet setup, the nginx vhost, and the GitHub secrets the workflow needs are in
[`deploy/README.md`](deploy/README.md).

### Language Client Selection
Currently there are no voice translations available for languages other than english. However, if you want to use the addon with a non English client, you can still do so by creating the lookup tables in the client's respective language.

To create the lookup tables, you can use the following command, with `LANGUAGE_CODE` representing the required language for the client:
```bash
python cli-main.py gen_lookup_tables --lang=LANGUAGE_CODE
```
The default selection, when no language code is provided, is English. Please be aware that the quality of text completion for translations in languages other than English can vary significantly.

Unlike `build`, this reads the world database directly, so it needs the Docker MySQL and the
extraction dependencies — the committed corpus is English only.

The following language codes are supported:
| Language Code | Language |
| ------------- | ------- |
| enUS          | English |
| enGB          | English |
| koKR          | Korean |
| frFR          | French |
| deDE          | German |
| zhCN          | Simplified Chinese |
| zhTW          | Traditional Chinese |
| esES          | European Spanish |
| esMX          | Mexican Spanish |
| ruRU          | Russian |

## Output

`synthesize` writes into the audio store at `audio/{quests,gossip}/`, which is gitignored and
is the project's most expensive asset — it moves between machines with `make push` / `make
pull` and never through git or CI. `build` copies from there into
`dist/AI_VoiceOverData_Vanilla/generated/sounds/`, alongside every lookup table and the
`sound_length_table.lua` computed from exactly those mp3s.

### Reports from inside the game

The addon shows a **Report** button on the quest detail panel and on the sound queue frame,
whether or not audio actually played — a silent quest is among the most useful things a player
can tell you. Clicking it opens a copy box holding an address, because the client cannot open a
URL or send anything anywhere; the player copies it and opens it in a browser.

The address is built from what the client can see, never from what the data module resolved:
`/r/quest/{questID}/{accept|progress|complete}`, or `/r/npc/{creatureID}` for gossip, for a
client reporting quest id `0`, and as the fallback whenever a quest id is unavailable. That
matters because a data module which failed to load produces no `soundData` at all, and that is
exactly the state most worth hearing about. It also means there is no slug or hash shared
between Lua and Python that could silently drift.

The landing page resolves the address against the corpus, plays the take that is currently
live, and hosts the form. An address that resolves to nothing still renders the form — an
addon sending players to a page the corpus does not know about is itself a bug report.

`POST /api/reports` is the only unauthenticated write in the explorer. It is defended by a
honeypot field answered with `200` rather than `400` (an error only teaches a script to stop
sending the field), a limit of ten reports per hour per IP counted in Postgres so it survives a
pm2 restart, and a category checked against a closed set. The IP is the rate limiter's key and
nothing else: never displayed, never read back. Signing in replaces any typed name.

Collaborators and admins triage at `/reports`, marking each report fixed, not a problem, or
reopening it. **A report never becomes a regeneration job.** Regenerating spends ElevenLabs
credits, so nothing public can start one; someone reads the report, listens, and queues the
file through the normal flow.

## Addon Install

```bash
python cli-main.py install --force        # dist/<module> -> the AddOns folder
```

`install` targets `_classic_era_` by default (`--addons` for another path) and moves any
existing install aside to `<module>.replaced` rather than deleting it. The addon itself is a
separate folder in the same AddOns directory; symlink both for faster development:

```bash
export WOW_DIR=PATH_OF_YOUR_WOW_DIR
ln -s "$PWD/AI_VoiceOver_Continued" "$WOW_DIR/_classic_era_/Interface/AddOns/AI_VoiceOver_Continued"
ln -s "$PWD/dist/AI_VoiceOverData_Vanilla" "$WOW_DIR/_classic_era_/Interface/AddOns/AI_VoiceOverData_Vanilla"
```

Use `AI_VoiceOver_Continued/` on a current client. Upstream `AI_VoiceOver/` calls
`GetNumAddOns`, `GetAddOnMetadata` and `LoadAddOn`, which Blizzard moved to `C_AddOns` in
10.2 and removed in 11.0.2, so on Classic Era 1.15.9 it errors while enumerating and the
sound pack never registers. Install one player or the other, never both — two copies of the
addon fight over the same `VoiceOverDB` and the same sound queue.

The data module names no `RequiredDeps`. It used to require `AI_VoiceOver`, which made
`LoadAddOn` fail with `DEP_DISABLED` whenever the player was a fork under another folder name
and the original sat disabled. The module is `LoadOnDemand` and its `Module.lua` returns early
unless `VoiceOver.DataModules` exists, so the dependency bought nothing and cost the fork.
## Tests

```bash
pip install -r requirements-dev.txt && pytest       # the pipeline
cd web && pnpm typecheck && pnpm test               # the explorer
```

The web suite runs against a **real Postgres**, because the invariants it protects — archive
the current take before anything overwrites it, never hand the same file to two jobs — live in
schema constraints rather than in code. It reads `DATABASE_URL` from the environment or from
`web/.env.local`, and runs one file at a time, since claiming from a shared queue is global by
definition. `audio.test.ts` is the one that stops a naming change going unnoticed: it asserts
every file in the store is addressed by some corpus line.

## Contributing
If you want to contribute to this project, please feel free to open an issue or submit a pull request.

# CLI Docs

## Dataframe Schema

The dataframe schema before calling the `preprocess_dataframe` function consists of the following columns:

| Column        | Description                                                  |
|---------------|--------------------------------------------------------------|
| `source`      | Indicates the type of interaction, can be 'accept', 'progress', 'complete', or 'gossip' |
| `quest`       | The quest ID or empty string if it's a gossip interaction    |
| `text`        | The text template content of the interaction                           |
| `DisplayRaceID` | The race ID of the NPC involved in the interaction          |
| `DisplaySexID`  | The gender ID of the NPC involved in the interaction        |
| `name`        | The name of the NPC involved in the interaction               |
| `type`        | The type of the NPC involved in the interaction ('creature', 'gameobject', or 'item') |
| `id`          | The creature/gameobject/item ID of the NPC involved in the interaction |

`DisplayRaceID = -1` is used for interactions with inanimate NPCs: gameobjects, items etc. It's mapped to a voice called "narrator" in `RACE_DICT`.

## New Fields Added by `preprocess_dataframe`

The `preprocess_dataframe` function adds the following new fields to the dataframe:

| Column                   | Description                                                  |
|--------------------------|--------------------------------------------------------------|
| `race`                   | The race of the NPC, mapped from `DisplayRaceID` using `RACE_DICT` |
| `gender`                 | The gender of the NPC, mapped from `DisplaySexID` using `GENDER_DICT` |
| `voice_name`             | The voice name, which is a combination of the race and gender fields |
| `templateText_race_gender` | A combination of the text, race, and gender fields          |
| `templateText_race_gender_hash` | A hash of the `templateText_race_gender` field          |
| `cleanedText` | `text` after rendering template |

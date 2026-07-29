# VoiceOver for World of Warcraft

## v2: https://allvoice.ai
Contribute voices on [allvoice.ai](https://allvoice.ai) so I can give each NPC a unique AI voicemodel to power their dialog. The top rated voice for each NPC will be used. 


### [voiceover discord](https://discord.gg/VdhUmA8ZCt)
### [allvoice code](https://github.com/allvoice/allvoice-website)

## Overview

A pipeline for producing AI voiceovers for WoW Classic dialog. The sound pack and the addon
data module are build outputs of this project.

Three stages, and only the first needs a database:

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

- Python 3.10+
- Docker — **only** to refresh the corpus (see "Refreshing the corpus")

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
docker compose up -d
python cli-main.py init-db                # download and import the vmangos dump
python cli-main.py extract                # writes corpus/corpus.json.gz
```

Commit the resulting corpus; the diff is reviewable.

## Voice Setup
The generation scripts assume you have voices created in Elevenlabs named in the format `race-gender`. For the exact races the script checks your elevenlabs account for, refer to `tts_cli\consts.py`. Gender will always either be `male` or `female`. ex: `orc-male`. You will need to create your own voice clones. A good place to get samples is @ https://www.wowhead.com/sounds/npc-greetings/name:orc 
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
with no shared key. The web explorer reassembles that view:

```bash
docker compose up -d postgres          # accounts and roles live here
cd web && pnpm install
cp .env.example .env.local
psql "$DATABASE_URL" -f migrations/0001_auth.sql
pnpm dev                               # http://localhost:3000
```

Search by NPC name or id, or quest title or id, and play any line in the browser. The
corpus and the audio store are still read straight off disk and never written — Postgres
holds only accounts, sessions and roles. Run `import-audio` first, or every line shows as
a gap.

Lines with no audio are marked. `no audio` is a real gap; `progress` and `invalid-chars`
are lines the generator deliberately never voices.

#### Accounts and roles

Registration at `/register` is open and needs no email confirmation. Everyone starts as a
**member**, which is the same read-only explorer an anonymous visitor gets.

| Role | Can |
|---|---|
| `member` | browse and play, like a signed-out visitor |
| `collaborator` | the above, plus **Regenerate** on every line, quest and NPC, and the take history behind each |
| `admin` | the above, plus `/admin` to change anyone's role, `/voices` to manage voices and the global generation settings, and `/lexicon` to correct how names are pronounced |

#### Regenerating audio

A line, a quest or a whole NPC can be re-voiced from the explorer. The browser drives a
batch one line at a time, so there is no queue and no worker: the loop, its progress and its
stop button live on the page, and closing the tab ends the batch with the finished lines
already written.

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
with its silent G, Kel'Thuzad, Cairne, and 130 more, each with an IPA pronunciation. Saving
uploads them to ElevenLabs as a pronunciation dictionary and pins every later request to that
exact version.

**You do not need IPA.** An entry gives either an IPA pronunciation or a plain respelling —
`nomeregan` — and the editor switches between the two in one click. The trade is exactness
against reach: IPA becomes a phoneme rule, which is precise but honoured only by `eleven_v3`
and `eleven_flash_v2`; a respelling becomes an alias rule, which is only as good as the guess
at the new spelling but works on every model. Both kinds sit in one dictionary, so the lexicon
does not have to pick. When the configured model ignores phoneme rules the page says how many
entries that silently skips, rather than implying the whole page is inert.

Respell it as it should be *said*, not as it should be *read*: `nomeregan`, not
`NOME-reh-gan`. Capitals can be spoken as an acronym and hyphens as pauses. The stress form
belongs in the entry's `say` field, which is for people and is never sent.

**A phoneme rule cannot be case-insensitive.** ElevenLabs discards one carrying
`case_sensitive: false` *silently* — a 200, an id, a version, and the rule simply absent from
the stored dictionary. Alias rules tolerate the same flag, which is what made this so hard to
see. So phoneme rules go up with `case_sensitive: true`, one per spelling the corpus actually
contains: 134 entries become 152 rules, because 17 names appear in more than one casing
(`Qiraji`/`qiraji`, `Aku'mai`/`Aku'Mai`, `Forsaken`/`forsaken`/`FORSAKEN`). Aliases keep
`case_sensitive: false`, where it works.

**Every upload is read back and counted.** Send N rules, download the dictionary, count the
lexemes. A mismatch is shown on the page rather than trusted away — the absence of this check
is why a lexicon that had never applied a single pronunciation reported itself healthy for
weeks. Saving creates a new dictionary and pins every later request to that exact version.

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

#### Managing voices

`/voices` is admin-only. It lists the 20 `race-gender` voices the corpus needs, busiest
first, and marks which exist in the ElevenLabs account. Expanding one shows the clips it
would be cloned from: upload, play back, delete, and **merge** a selection into one take with
an adjustable pause.

Merging is there because the practical source is wowhead NPC greetings, about a second each.
ElevenLabs treats combined length as what decides clone quality — one to two minutes is the
target, past three it grows unstable — and a pile of one-second files gives the model no
continuity between them. It defaults to deleting the originals, because cloning uploads every
clip in the folder and keeping both would send the same audio twice.

**Create voice** spends one of the account's custom voice slots (30 on Creator). **Replace**
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

The explorer is hosted on a DigitalOcean droplet. Pushing to `master` builds and ships it
automatically; the audio store moves separately, by hand, because it is 1.1 GB and belongs
in neither git nor CI.

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
survives a rollback untouched.

First-time droplet setup, the nginx vhost, and the GitHub secrets the workflow needs are in
[`deploy/README.md`](deploy/README.md).

### Language Client Selection
Currently there are no voice translations available for languages other than english. However, if you want to use the addon with a non English client, you can still do so by creating the lookup tables in the client's respective language.

To create the lookup tables, you can use the following command, with `LANGUAGE_CODE` representing the required language for the client:
```bash
python cli-main.py gen_lookup_tables --lang=LANGUAGE_CODE
```
The default selection, when no language code is provided, is English. Please be aware that the quality of text completion for translations in languages other than English can vary significantly.

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
The generated TTS audio files will be saved in the sounds folder, with separate subfolders for quests and gossip. Lookup tables and sound length tables will also be generated for use in the addon. 

## Addon Install
Copy over the `generated` folder to the VoiceOverData_Vanilla folder, then the VoiceOver and VoiceOverData_Vanilla folder to `World of Warcraft/_classic_era_/Interface/AddOns`. Alternatively, you can syslink instead of copying for faster development.
Example syslink:
```bash
export WOW_DIR=PATH_OF_YOUR_WOW_DIR
ln -s ./VoiceOver "$WOW_DIR/_classic_era_/Interface/AddOns"
ln -s ./VoiceOver_Vanilla "$WOW_DIR/_classic_era_/Interface/AddOns"
```
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

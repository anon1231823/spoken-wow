# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repo-wide conventions (code style, comment discipline) live in `AGENTS.md` — read it too.

## What this repo is

Four separate things share one tree:

1. **`tts_cli/` + `cli-main.py`** — the Python pipeline that turns the vmangos world DB into a committed corpus, synthesizes mp3s with ElevenLabs, and builds the addon data module.
2. **`web/`** — a Next.js explorer (deployed to a DigitalOcean droplet) for browsing the corpus, playing lines, and regenerating audio. It reads the corpus and the audio store off disk; Postgres holds only accounts, roles, voice provenance, take history, the lexicon and the regeneration queue.
3. **`AI_VoiceOver/`** — upstream's addon (Lua), kept only as the baseline to diff the fork against. Nothing builds or releases it.
4. **`VoiceOverRedux/`** — the addon this project ships, released by tag through `.github/workflows/release-player.yaml`. A fork of the above, adapting the removed global addon-management APIs to `C_AddOns` and the gossip APIs to `C_GossipInfo` so the player runs on Classic Era 1.15.9. It was `AI_VoiceOver_Continued` until the rename; the sound pack it loads is `VoiceOverReduxAudio`, formerly `AI_VoiceOverData_Vanilla`. **A rename uninstalls nothing**, so `VoiceOver.lua` disables every superseded player it finds - by AceAddon name for the session, by folder name for the next login - and both lists only ever gain entries. Packs are found by the `X-VoiceOver-DataModule-Version` TOC key rather than by name, so an old pack still loads.

`README.md` is unusually detailed and is the primary prose reference — check it before inferring behaviour from code, and update it when behaviour changes.

## Commands

Python (from repo root, with `.venv` active):

```bash
pip install -r requirements.txt          # everyday path, pure Python
pip install -r requirements-dev.txt      # + pytest, wordfreq
pip install -r requirements-extract.txt  # + pandas/numpy/PyMySQL, corpus refresh only
pytest                                   # all tests
pytest tests/test_build.py::test_name    # one test
python cli-main.py --help
```

Web (from `web/`):

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm typecheck      # tsc --noEmit — CI gate
pnpm test           # vitest run
pnpm test src/lib/generation/queue.test.ts   # one file
pnpm build
```

Several web tests (`history.test.ts`, `queue.test.ts`, anything touching versions) run against a **real Postgres** — the invariants they protect live in schema constraints. `DATABASE_URL` comes from a real env var or `.env.local` (see `web/vitest.config.ts`); apply migrations with `deploy/bin/migrate.sh "$PWD/web"`, the same script the droplet uses. `fileParallelism` is off because queue claiming is global.

Audio store and droplet plumbing are all in the `Makefile` (`make help`): `push`/`pull` for `audio/`, `pull-voices`/`pull-history` for the irreplaceable directories, `releases`/`rollback`/`ssh-check` for the droplet. Every target is heavily commented with the failure it exists to prevent — read the comment before changing one.

## Architecture

**The corpus is the hinge.** `corpus/corpus.json.gz` (committed, 17.5k lines) is written by `tts_cli/corpus.py` from MySQL and read by everything else. Producing audio, building the module and running the web app never touch a database. Extraction is deliberately generous (spawn positions are captured though little reads them) because standing the world DB back up is the expensive mistake.

**Filenames are load-bearing and derived in exactly one place.** `tts_cli/naming.py` owns both `fileName` (`{questID}-{accept|complete}` or `md5(text+race+gender)`, optional `m-`/`f-` prefix) and `lineId` (`q:…` / `g:…`). The addon resolves sounds through a generated lookup table, so a name off by one character plays silence. `web/src/lib/audio.ts` is the TypeScript twin of `subfolder_from_line_id`, and `audio.test.ts` pins them together by asserting every file on disk is addressed by some corpus line. Do not derive filenames anywhere else.

**Voices are `race-gender-flavor`, 54 of them.** The flavor is which of a race-gender's several NPC voice sets an NPC actually uses; `tts_cli/flavors.py` recovers it from SoundEntries names and the corpus carries the result. `web/src/lib/voices/slots.ts` derives the roster from the corpus rather than listing it, which also makes it the whitelist that keeps a voice name safe as a path segment.

**A job is a file, not a line.** ~1,076 mp3s are shared by several NPCs, so regeneration replaces a file and every line pointing at it hears the change. The queue is keyed on the file for this reason.

**Audio lives outside git and outside releases.** `audio/` (~1.1 GB), `audio-history/`, `voice/samples/`, `audio-previews/` are gitignored and live in `shared/` on the droplet, surviving deploys and rollbacks. `web/src/lib/paths.ts` resolves every one of them and documents why each is a sibling rather than a subdirectory — `readStoreIndex` walks `audio/{quests,gossip}` and `make push` rsyncs `audio/`, so anything nested there would be miscounted by both. Version 0 of each history file is audio this project cannot reproduce; never prune it.

**The regeneration queue.** `boot.ts` starts it; `leader.ts` picks one pm2 worker via a session-scoped Postgres advisory lock (same namespace as the per-file locks in `lock.ts`); `worker.ts` drains with a concurrency budget derived from the plan tier; `queue.ts` is the only module that knows the column names. `web/src/lib/db.ts` explains why `POOL_MAX` is 30 — the queue holds two clients per in-flight job.

**Migrations are forward-only and additive.** `deploy/bin/activate.sh` migrates *before* the symlink swap, and rollback restores code without un-applying schema, so a release must run against the schema of the release after it.

**A report is a claim, not a job.** The addon's Report button builds an address — `/r/quest/{id}/{accept|progress|complete}` or `/r/npc/{id}` — from what the client can see rather than from anything the data module resolved, since a module that failed to load is the failure most worth reporting. The player copies it, opens it, and fills in a form; `POST /api/reports` is the only unauthenticated write in the app, defended by a honeypot, a Postgres-backed limit of ten per hour per `x-real-ip`, and closed-set validation. `line_report` is separate from `line_issue` because one is a human's claim about audio and the other a scan's finding about text. Nothing connects a report to the regeneration queue: a job spends ElevenLabs credits, so a collaborator reads the report and queues the file by hand.

**The shipped module is transcoded, the store is not.** `make pack` (scripts/package-audio.sh) stages a VBR copy of the store and hands it to `build --store`, so there is still one definition of what a module contains. Only clips above 80 kbps are encoded - `tools/plan_transcode.py` reads each file's bitrate, because 7,164 of 9,969 files are the inherited 64 kbps pack and `-q:a 6` lands at ~65 kbps, where a second lossy pass costs quality and saves nothing. 1.6 GB becomes 1.3 GB. The cache in `audio-transcoded/` is keyed on the master's md5 (mtime would be wrong: `make pull` copies the droplet's timestamps), and the length table is computed after the copy so it describes the files that ship.

**Some lines are ignored outright.** `line_ignore` (migration 0017) records lines nobody will ever voice - the 35 war-effort tallies whose `$2113w` is a live server counter, and Blizzard's test quest 1 - keyed on `lineId` rather than the file, because a dead line can share an mp3 with a live one. The web app hides them from every search unless `ignored=1`, refuses to regenerate one, and `make pull-ignores` exports the table to the committed `corpus/ignored.json` for the sides with no database: `tts_cli/ignores.py` reads it, `build` drops both the audio and the lookup entries, and the rsync targets derive `.rsync-ignored` from it before every transfer. `ignored_files` names a file only when *every* line addressing it is ignored - excluding one otherwise would strand the line that still needs it.

**Reachability is not extracted.** `tts_cli/corpus.py` applies no patch filter, but vmangos gates `quest_template` (`patch <= P`), the four questgiver relation tables (`P BETWEEN patch_min AND patch_max`) and the spawn tables the same way - so the corpus holds quests a 1.12 server never hands out. `tts_cli/reachability.py` encodes those three gates and is tested against fixtures; `tools/scan_unreachable_quests.py` feeds it from MySQL and prints a report. Findings are leads, never actions: the spawn gate flags Alterac Valley quests whose givers the battleground scripts spawn. `--gossip` asks the same of a speaker rather than a quest and is noisier still - 47 NPCs, all script-spawned so far. `docs/unreachable-quest-candidates.md` is the independent second source, from Questie's blacklist.

**Stage directions are narrated, and only by the web app.** Blizzard writes `<Advisor Belgrum opens the note.>` inside the NPC's own quest text. A *capitalised* bracketed span is a stage direction and is read by `narrator-male`; a *lowercase* one is a sound the NPC makes (`<hic>`, `<cough>`) and is rewritten by `audioTags` into ElevenLabs' `[hic]` tag syntax, which `eleven_v3` performs in the NPC's own voice — no narrator says "hic". Capitalisation separates all 90 spans in the corpus with no exceptions — do not also require a full stop, which misclassifies `Motega shrugs his shoulder`. The tag rewrite runs on the whole line before `segments`, so it reaches the single-voice path too, and `staleFiles` applies the same two transforms in the same order or every tagged take reads as outdated. This means `web/src/lib/text-gate.ts` is no longer a mirror of `INVALID_CHARS` in `tts_cli/corpus.py`: the web app voices 62 lines the CLI still refuses. That is the second deliberate divergence between the two generators, alongside the pronunciation dictionary.

**Generation settings have two layers.** `voice/generation.json` + `voice/pronunciation.json` are what the Python CLI reads and ship inside each release; the database rows edited at `/voices` override them for the web app. The lexicon has no file layer at all — it lives only in Postgres (seeded by `0008`), and the Python CLI sends no pronunciation dictionary, which is the one place the two generators diverge.

`docs/superpowers/specs/` and `docs/superpowers/plans/` hold the design documents for the explorer and the queue.

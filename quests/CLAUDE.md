# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repo-wide conventions (code style, comment discipline) live in `AGENTS.md` — read it too.

## What this repo is

Three separate things share one tree:

1. **`tts_cli/` + `cli-main.py`** — the Python pipeline that turns the vmangos world DB into a committed corpus, synthesizes mp3s with ElevenLabs, and builds the addon data module.
2. **`web/`** — a Next.js explorer (deployed to a DigitalOcean droplet) for browsing the corpus, playing lines, and regenerating audio. It reads the corpus and the audio store off disk; Postgres holds only accounts, roles, voice provenance, take history, the lexicon and the regeneration queue.
3. **`AI_VoiceOver/`** — the WoW addon (Lua), released by tag through `.github/workflows/release-player.yaml`. Largely upstream; the pipeline is what this fork develops.

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

**Generation settings have two layers.** `voice/generation.json` + `voice/pronunciation.json` are what the Python CLI reads and ship inside each release; the database rows edited at `/voices` override them for the web app. The lexicon has no file layer at all — it lives only in Postgres (seeded by `0008`), and the Python CLI sends no pronunciation dictionary, which is the one place the two generators diverge.

`docs/superpowers/specs/` and `docs/superpowers/plans/` hold the design documents for the explorer and the queue.

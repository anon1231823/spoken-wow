# AGENTS.md

Repo-wide conventions. Each project also has its own, and they still apply:
`docs/quests/AGENTS.md` and `docs/zones/AGENTS.md`.

## What this repository is

Four things share one tree, and they are not equally finished:

1. `addons/` — the shipped Lua. `SpokenPlayer` is the player; `SpokenQuests`,
   `SpokenZones` and `SpokenBooks` are feature addons that queue clips through
   it; `SpokenZonesAudio` and `SpokenBooksAudio` are sound packs.
2. `apps/` — `web` is the site: one domain, `spoken.rusty.one`, with a quests
   section, a zones section and a books section. It is the merge of two sites
   that came before it; their names are redirect vhosts now.
3. `pipelines/` — `quests/` is Python, `zones/` and `books/` are Node, and `lib/` is the
   handful of plain `.mjs` modules both Node halves share, starting with the `.env` reader.
   The three are also scheduled to merge, onto TypeScript. The zones half is not merely a CLI any
   more: the site imports it (`apps/web/src/lib/zones/tools.ts`) and webpack
   compiles it into the bundle, so a change there is a change to the site. The
   books half is the same arrangement, reading page text out of the vmangos
   world DB that `quests/` already provisions — see `docs/books/`.
4. `packages/` — where the shared TypeScript will live. Empty for now.
5. `deploy/` — `web/` is the deployment: the /srv tree, the nginx vhosts, the
   release scripts and the runbook.

## Rules that are load-bearing

**The droplet is never named in the tree.** The host, the deploy user and the key
come from the environment (`make/droplet.mk`) locally, and from repository secrets
— `DO_HOST`, `DO_USER`, `DO_SSH_KEY`, `DO_KNOWN_HOSTS` — in CI. A hostname added
back to a Makefile, an nginx comment or a runbook is a regression, not a
convenience. The two pre-merge deployments are gone; `legacy-freeze` is the tag
that still has them.

**Filenames and line ids are frozen.** `q:33:accept`, `g:{md5}`, `z:{mapID}`,
`s:{mapID}:{key}`, `b:{pageTextID}` and their paths on disk do not change. Renaming one means
re-shipping a sound pack every user has already downloaded and invalidating
the take history that records what produced each file.

**Do not merge the Makefiles.** They collide on a dozen target names.
Each target is commented with the failure it exists to prevent — read the
comment before changing one, and note that several `push`/`pull` targets
rsync with `--delete` against directories holding audio that cannot be
regenerated.

**Shared credentials live in the repo-root `.env`.** One ElevenLabs key, one CurseForge
token, one Wago token, one `DATABASE_URL`, one vmangos `MYSQL_*` block, read by `pipelines/lib/env.mjs`,
`tts_cli/env_vars.py`, `apps/web/next.config.ts` and the three `scripts/*/release.sh`. A
`pipelines/<name>/.env` is read after it and wins, and is for what is that pipeline's alone.
Copying a shared variable back into one is how the three copies that came before drifted:
zones held a stale ElevenLabs key, books held a `MYSQL_*` block nothing read, and
`scripts/books/release.sh` searched all three files to find the one CurseForge token.

**Audio lives outside git.** Several directories are irreplaceable rather
than merely large; `.gitignore` says which, and why, for each one.

## Comments

Comment the *why*, not the *what*. Both imported projects are consistent
about this and it is the main reason their history is readable — a comment
naming the failure a line prevents is worth more than a comment restating
the line. Keep it.

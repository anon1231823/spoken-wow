# AGENTS.md

Repo-wide conventions. Each project also has its own, and they still apply:
`docs/quests/AGENTS.md` and `docs/zones/AGENTS.md`.

## What this repository is

Four things share one tree, and they are not equally finished:

1. `addons/` — the shipped Lua. `SpokenPlayer` is the player; `SpokenQuests` and
   `SpokenZones` are feature addons that queue clips through it;
   `SpokenZonesAudio` is a sound pack. `addons/vendor/` holds upstream's
   addons as a diff baseline and nothing builds them.
2. `apps/` — `web` is the site being built: one domain, `spoken.rusty.one`, with a
   quests section and a zones section. `web-zones` is the site it is absorbing, and
   stays until the cutover so its code can be read beside the port of it.
3. `pipelines/` — `quests/` is Python, `zones/` is Node. Also scheduled to
   merge, onto TypeScript.
4. `packages/` — where the shared TypeScript will live. Empty for now.

## Rules that are load-bearing

**The two live sites are frozen.** voiceover.rusty.one and lore.rusty.one keep
serving the releases they have, and neither deploy workflow runs from `main` any
more — both are dispatch-only and refuse a ref where the merge has landed. Nothing
on this branch reaches a live site until spoken.rusty.one is stood up beside them
and the DNS is pointed at it. That means `deploy/quests/` and `deploy/zones/`
describe what is *running*, not what the code says: leave them matching the
droplet. A hotfix to either site is a dispatch against the `legacy-freeze` tag.

**Filenames and line ids are frozen.** `q:33:accept`, `g:{md5}`, `z:{mapID}`,
`s:{mapID}:{key}` and their paths on disk do not change. Renaming one means
re-shipping a sound pack every user has already downloaded and invalidating
the take history that records what produced each file.

**Do not merge the two Makefiles.** They collide on a dozen target names.
Each target is commented with the failure it exists to prevent — read the
comment before changing one, and note that several `push`/`pull` targets
rsync with `--delete` against directories holding audio that cannot be
regenerated.

**Audio lives outside git.** Several directories are irreplaceable rather
than merely large; `.gitignore` says which, and why, for each one.

## Comments

Comment the *why*, not the *what*. Both imported projects are consistent
about this and it is the main reason their history is readable — a comment
naming the failure a line prevents is worth more than a comment restating
the line. Keep it.

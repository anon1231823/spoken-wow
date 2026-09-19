# Spoken

Voiced dialogue, lore and text for World of Warcraft Classic. One platform,
several addons.

| Addon | Voices | Status |
|---|---|---|
| **Spoken** | nothing — it *is* the player: the queue, the frame, the minimap button | published as Spoken Player, id 1700375 |
| **SpokenQuests** | quest dialogue and NPC gossip | shipping, renamed from VoiceOver Redux |
| **SpokenZones** | zone and subzone lore | shipping, renamed from ZoneLore |
| **SpokenBooks** | books, letters and other in-world texts | addon built, narration in progress |

Every feature addon plays through `SpokenPlayer`, so a player who installs two of
them gets one queue and one window rather than two of each. Addon managers
install it automatically; the legacy-client zips bundle it, because those
clients have no manager to do it for them.

## Layout

```
addons/      the player, the feature addons, and the sound packs
apps/web     the site: spoken.rusty.one, with quests, zones and books sections
pipelines/   corpus extraction and voiceline generation
             quests/ is Python, zones/ and books/ are Node
deploy/web   the droplet: nginx, pm2, release scripts and the runbook
packages/    shared TypeScript
tests/lua/   the luajit addon harness
make/        one Makefile per project; the root Makefile dispatches
docs/        each project's own prose, until it is merged
```

## Working here

`make help` lists what is available. Targets are prefixed by project:

```
make web-<target>       # see make/web.mk   -- the site and its droplet
make quests-<target>    # see make/quests.mk
make zones-<target>     # see make/zones.mk
make books-<target>     # see make/books.mk
make test-player        # the Lua harness, all addons
```

`THIRD_PARTY.md` says what in here is not this project's, and under what terms —
the vendored Ace libraries, the game text the corpus is built from, and the wiki
lore the zones addon ships.

Read `AGENTS.md` before changing anything, and the project READMEs under
`docs/` for what each side actually does — both are unusually detailed and
both are the primary reference, not the code.

## History

This repository is the merge of two that came before it, imported with their
full history:

- `rusty-key/wow-voiceover` — now `quests`
- `rusty-key/wow-zone-lore` — now `zones`

`git log --follow` works across the move. Tags from the first are prefixed
`legacy/quests/` because they predate the addon they would otherwise appear
to name.

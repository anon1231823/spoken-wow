# Spoken

Voiced dialogue, lore and text for World of Warcraft Classic. One platform,
several addons.

| Addon | Voices | Status |
|---|---|---|
| **Spoken** | nothing — it *is* the player: the queue, the frame, the minimap button | being extracted |
| **SpokenQuests** | quest dialogue and NPC gossip | shipping, was VoiceOver Redux |
| **SpokenZones** | zone and subzone lore | shipping, was ZoneLore |
| **SpokenBooks** | books, letters and other in-world texts | planned |

Every feature addon plays through `Spoken`, so a player who installs two of
them gets one queue and one window rather than two of each. Addon managers
install it automatically; the legacy-client zips bundle it, because those
clients have no manager to do it for them.

## Layout

```
addons/      the player, the feature addons, and the sound packs
apps/        the websites (Next.js)
pipelines/   corpus extraction and voiceline generation
             quests/ is Python, zones/ is Node
packages/    shared TypeScript
tests/lua/   the luajit addon harness
make/        one Makefile per project; the root Makefile dispatches
docs/        each project's own prose, until it is merged
```

## Working here

`make help` lists what is available. Targets are prefixed by project:

```
make quests-<target>    # see make/quests.mk
make zones-<target>     # see make/zones.mk
make test-player        # the Lua harness, all addons
```

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

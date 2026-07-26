# ZoneLore

A World of Warcraft **Classic Era** addon that shows zone lore on the world map,
with lore text built from warcraft.wiki.gg at development time.

Target client: **Classic Era 1.15.9** (`## Interface: 11509`). Not built for
retail or the Anniversary/TBC client.

## Status

| Milestone | State |
|---|---|
| M0 skeleton, saved vars, slash commands | done, untested in-game |
| M1 wiki scraper → generated lore data | done, 49 zones |
| M2 world map side panel | done, untested in-game |
| M3 hover preview on the map | not started |
| M4 minimap button + standalone lore window | not started |
| M5 options panel | not started |

Nothing has been run inside WoW yet — see [Verifying in-game](#verifying-in-game).

## Layout

```
addon/ZoneLore/       the addon itself (this is what WoW loads)
  ZoneLore.toc
  Core.lua            namespace, saved variables, events, zone resolution
  Data/Zones.lua      GENERATED -- do not edit by hand
  UI/MapPanel.lua     the world map side panel
tools/
  scrape.mjs          warcraft.wiki.gg -> Data/Zones.lua
  validate.mjs        checks the generated Lua without a Lua interpreter
  seed-from-dump.mjs  compares the seed against a live client map dump
  seed/zones.json     uiMapID -> wiki page title
  seed/overrides.json hand-written lore that beats the scraped text
scripts/deploy.sh     install into the Classic Era AddOns folder
```

## Installing for development

```sh
./scripts/deploy.sh            # symlink; edits are live, just /reload in-game
./scripts/deploy.sh --status
./scripts/deploy.sh --remove
```

Symlinking means no redeploy per edit. If the client's AddOns list does not show
ZoneLore, use `./scripts/deploy.sh --copy` and re-run it after each change.
SavedVariables live under `WTF/`, so neither mode can lose your settings.

## Regenerating the lore data

```sh
node tools/scrape.mjs              # uses tools/cache/ where present
node tools/scrape.mjs --refresh    # re-fetch every page
node tools/scrape.mjs --only 1411 --verbose   # tune one zone, show filtering
node tools/validate.mjs            # check the generated Lua
```

The scraper needs Node 18+ and has no dependencies. It caches every raw API
response under `tools/cache/` (gitignored) so iterating on text cleanup never
re-hits the wiki, and throttles to one request per 500ms with an identifying
User-Agent.

### The era filter

Wiki zone intros narrate a zone across *every* expansion, so an unfiltered scrape
would tell a Classic Era player about Deathwing and Pandaria. `scrape.mjs` drops
any **sentence** containing a post-vanilla marker.

Sentence granularity matters: several intros are a single paragraph of otherwise
timeless description with one clause about a later expansion. Filtering by
paragraph either loses good vanilla lore or keeps the anachronism.

Terms deliberately *not* treated as post-vanilla, because vanilla lore uses them
legitimately: Draenor, Burning Legion, Northrend, Lich King, Scourge, Naxxramas,
the Third War, the Dark Portal, and lower-case "dragonflight" (the black/blue/
bronze/green flights all appear in vanilla zone text).

`cataclysm` *is* matched case-insensitively, because the wiki writes "until the
cataclysm, the huge lake from which the region takes its name" about Loch Modan —
and in Classic Era that lake is still full. A rare false positive on a Sundering
reference is cheaper than wrong-era geography; use `overrides.json` if one shows up.

`tools/validate.mjs` re-checks the generated file for leaks, so a filter
regression fails loudly rather than shipping.

### Fixing a zone by hand

Add an entry to `tools/seed/overrides.json` keyed by uiMapID with `full` (and
optionally `short`). Overrides win over scraped text and are the escape hatch for
a zone whose wiki intro is entirely post-vanilla.

### Correcting uiMapIDs

`tools/seed/zones.json` was seeded from the known Classic Era uiMapID block
(947 Azeroth, 1414 Kalimdor, 1415 Eastern Kingdoms, 1411–1458 zones and cities).
To check it against your own client:

```
in-game:  /zl dump      then  /reload
here:     node tools/seed-from-dump.mjs           # report differences
          node tools/seed-from-dump.mjs --write   # rewrite the seed from the client
```

`/zl verify` does a lighter version of the same check entirely in-game.

## Verifying in-game

```
/console scriptErrors 1     surface Lua errors (do this first)
/zl                         status for the current zone
/zl verify                  check all 49 entries against this client
/zl panel                   toggle the world map panel
/zl dump                    enumerate the map tree (dev)
```

Manual pass worth doing: open the map in a starting zone, walk across a zone
border with the map open, click up to the continent and back down, minimize and
maximize the map, then close and reopen it. The panel hides while the map is
maximized by design.

Also test with `Leatrix_Maps` both enabled and disabled — it manipulates the same
`WorldMapFrame` and will contend for the same area-label script once M3 lands.

## Licensing

Addon code: MIT.

Zone lore text in `addon/ZoneLore/Data/Zones.lua` is derived from
[warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed
**CC BY-SA 4.0**; each entry carries a `source` URL to its page. Any distribution
of this addon must keep that attribution and license the lore data under CC BY-SA.
Text in `tools/seed/overrides.json` is original and not covered by that.

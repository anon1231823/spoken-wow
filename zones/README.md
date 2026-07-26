# ZoneLore

A World of Warcraft **Classic Era** addon that shows zone lore on the world map,
with lore text built from warcraft.wiki.gg at development time.

Target client: **Classic Era 1.15.9** (`## Interface: 11509`). Not built for
retail or the Anniversary/TBC client.

## Status

| Milestone | State |
|---|---|
| M0 skeleton, saved vars, slash commands | done, tested in-game |
| M1 wiki scraper → generated lore data | done, 49 zones |
| M2 world map side panel | done, tested in-game |
| M2.5 subzone lore on map click | done; mechanism tested in-game, now all 46 zones |
| M3 hover preview on the map | done, tested in game |
| M4 minimap button + standalone lore window | done, **untested in-game** |
| M5 options panel and polish | done, **untested in-game** |

## Layout

```
addon/ZoneLore/          the addon itself (this is what WoW loads)
  ZoneLore.toc
  embeds.xml             loads the bundled libraries
  Core.lua               namespace, saved variables, events, zone/subzone lookup
  Data/Zones.lua         GENERATED -- do not edit by hand
  Data/Subzones.lua      GENERATED -- do not edit by hand
  UI/TextView.lua        shared scrolling wrapped-text widget
  UI/MapPanel.lua        the world map side panel
  UI/SubzoneClick.lua    resolves a map click to a subzone
  UI/HoverPreview.lua    lore tooltip while hovering the map
  UI/LoreWindow.lua      standalone browsable lore window
  UI/MinimapButton.lua   LibDBIcon minimap button
  UI/Options.lua         settings panel
  Libs/                  LibStub, CallbackHandler-1.0, LibDataBroker-1.1,
                         LibDBIcon-1.0 (copied from AI_VoiceOver_Continued)
tools/
  lib/wiki.mjs           shared fetching, era filter, Lua emission
  scrape.mjs             warcraft.wiki.gg -> Data/Zones.lua
  scrape-subzones.mjs    warcraft.wiki.gg -> Data/Subzones.lua
  validate.mjs           checks the generated Lua without a Lua interpreter
  lua-syntax-check.py    block-balance check for the addon's Lua
  seed-from-dump.mjs     compares the seed against a live client map dump
  seed/zones.json        uiMapID -> wiki page title
  seed/subzones.json     which parent zones to scrape subzones for
  seed/overrides.json    hand-written lore that beats the scraped text
scripts/deploy.sh        install into the Classic Era AddOns folder
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

### Source: prefer the wiki's Classic-specific pages

warcraft.wiki.gg keeps **separate `<Name> (Classic)` articles** for places whose
description changed after vanilla. These are written about the 1.x world rather
than filtered down from an all-expansions article, so they are era-correct at the
source:

| | general page | `(Classic)` page |
|---|---|---|
| Durotar | "borders the **Northern** Barrens" (Cata split) | "borders **the Barrens**" |
| Darkshore | Auberdine absent (Cataclysm destroyed it) | "the port of **Auberdine**" |

**39 of the 46 zone maps** have one; the exceptions are Moonglade and the six
capital cities, which fall back to the general page. For subzones only a couple
have a `(Classic)` variant, so most still come from the general page.

`fetchClassicTitleIndex` builds the lookup from `Category:Classic zones` and
`Category:Classic subzones` in two requests, and `classicVariant` handles the
wiki dropping a leading article ("The Barrens" → "Barrens (Classic)"). The
`(Classic)` suffix never reaches the addon — display names and lookup keys are
always derived from the bare title. Pass `--no-classic` to ignore these pages.

The era filter still runs over Classic pages as a safety net, and still earns its
keep on a handful (Blasted Lands, Loch Modan, Eastern Plaguelands, Silithus).

Two alternatives were checked and rejected: `Category:Classic subzones` (83 pages)
is only a tag over pages already fetched — Auberdine is in
`Category:Darkshore subzones` already, so there was no coverage gap — and the
wiki's revision history reaches back to 2004, so a pre-Cataclysm-2010 revision was
viable, but it needs raw wikitext parsing and would still contain TBC and WotLK
content.

### Thin leads fall back to article sections

Some pages lead with one sentence and keep the description under a heading:
`Elwynn Forest (Classic)` opens with "Elwynn Forest is the starting zone for
playable humans." and puts the real text under `== Geography ==`, which
`exintro` skips. When a lead comes in under the threshold (300 chars for zones,
200 for subzones), `fetchLoreText` re-fetches the full article and takes the
lore-bearing sections — Geography, Description, History, Lore, Overview — capped
on a paragraph boundary. Elwynn went 55 → 804 chars. Quest tables, NPC lists and
"Patch changes" are never included.

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

## Subzones

Click a subzone on a zone map and the panel swaps to that subzone's lore, with a
"< Back to \<Zone\>" link. Covers **1304 subzones across all 46 zone maps**.

```sh
node tools/scrape-subzones.mjs              # all zones in the seed
node tools/scrape-subzones.mjs --list 1420  # just list the wiki category
node tools/scrape-subzones.mjs --zone 1420 --verbose
```

Counts range from Ashenvale's 59 down to Alterac Mountains' 5. A full run is about
1300 pages, roughly 11 minutes at the 500ms throttle; with a warm
`tools/cache/` it is under a minute.

Azeroth (947), Kalimdor (1414) and Eastern Kingdoms (1415) are deliberately
excluded: they are not Zone-type maps, so a click on them is Blizzard's own
navigation and `UI/SubzoneClick.lua` ignores them. 44 of the 46 resolve their
category from the zone name; The Barrens and The Hinterlands need a `category`
override because the wiki drops the leading article. For the Barrens the vanilla
`Barrens subzones` category is correct, not the Cataclysm-split
`Northern Barrens subzones`.

Category queries are pinned to `cmnamespace=0`: `cmtype=page` alone lets through
project and talk pages that have been miscategorised on the wiki, which is how
`Warcraft Wiki talk:Village pump/Archive11` first turned up as a Hillsbrad
subzone.

`Data/Subzones.lua` is about 1 MB. That is well within what addons ship
(`AI_VoiceOverData_Vanilla` in the same AddOns folder is 3.1 MB), but if load time
becomes a concern the file is a candidate for splitting per zone behind
`## LoadOnDemand`.

### Why subzone lore is keyed by name

Subzones are **areas, not uiMapIDs** — `C_Map.GetMapInfoAtPosition` cannot see
them, because it only returns child *maps*. The API that resolves a cursor
position to a subzone is `MapUtil.FindBestAreaNameAtMouse`, and it returns a
**name string, not an ID**. So `Data/Subzones.lua` is keyed by parent uiMapID and
then by a canonical form of the name.

That canonical form matters because the client and wiki disagree cosmetically:
the wiki titles a page **"Bulwark"** while the client reports **"The Bulwark"**.
`normaliseKey` (JS) and `ZoneLore:NormaliseAreaKey` (Lua) both lower-case, drop a
leading "the", strip apostrophes and collapse punctuation to single spaces, so
both sides meet at `bulwark`. `tools/validate.mjs` asserts the two
implementations stay in step and that every generated key is already canonical —
a non-canonical key would be silently unreachable.

If a client name still misses, `tools/seed/subzones.json` has an `aliases` section
mapping a client-reported name to a wiki page title. Use `/zl debug` in-game to
see the raw name.

### Post-vanilla subzones are kept on purpose

Silverpine's category includes Cataclysm-era places like Forsaken High Command and
the Gilneas Liberation Front Base Camp, and the text filter does not reliably
catch them. They are left in: lookup is driven by what the client reports, and the
Era client never reports an area that does not exist in 1.15.9, so those rows are
inert and cost only file size. What matters is that areas which *do* exist carry
no post-vanilla text, which the sentence filter handles.

## Hover preview

Hovering a zone on a continent map, or a subzone on a zone map, shows that place's
`short` lore in a tooltip at the cursor. `/zl hover` toggles it.

It deliberately shows nothing when there is no lore for what is under the cursor,
and nothing for the zone you are already looking at, since the panel is showing
that already.

### Why a tooltip and not the map's area label

The original plan was to replace the area-label data provider's `OnUpdate` and
pass lore as the label's `description`, which is the mechanism `Leatrix_Maps` uses
for zone levels and fishing skill. That was abandoned on purpose: only one addon
can own that script, `ZoneLore` sorts after `Leatrix_Maps` so it would load second
and win, and winning would silently disable a feature of an addon already
installed here. A "conflict guard" in that design is really just choosing which
addon loses.

A separate tooltip shares no state, cannot conflict, and has far more room for
prose than the area label's single small description line. The cost is that it
looks less native than text under the map's big centred zone name.

The driver is a frame parented to `WorldMapFrame`, so its `OnUpdate` only runs
while the map is open, throttled to 100ms. It uses its own tooltip rather than
`GameTooltip` because map pins own `GameTooltip` while hovered, and it suppresses
itself when `WorldMapFrame:IsCanvasMouseFocus()` is false -- that is exactly when
the cursor is over a pin and Blizzard's tooltip should be the only one showing.

## Minimap button and lore window

A minimap button (LibDBIcon) is the entry point that does not need the world map
open. Its tooltip shows lore for wherever the player is standing -- the subzone if
there is one, otherwise the zone. **Left-click** opens the lore window,
**right-click** toggles the world map panel. `/zl minimap` hides or shows it.

The lore window is movable, closes on Escape, and browses everything: the left
column lists all zones, and clicking one expands its subzones beneath it.

It re-syncs to where the player is standing on **every** open, not just the first,
and scrolls that row into view. If the player is standing in a subzone that has
lore, that subzone is selected rather than the zone, since it is the more specific
answer. The player's map is resolved through `GetLoreWithFallback`, because
`C_Map.GetBestMapForUnit` can return an indoor or micro map -- an inn, a dungeon --
which is not itself a key in `Zones`.

### Why the list is an accordion

Only one zone expands at a time. That caps the row count at about 108 (49 zones
plus Ashenvale's 59 subzones), which is few enough that every row can be a real
button with no view virtualisation. Expanding everything at once would be 1353
rows, so the accordion is a constraint rather than a preference.

Zones are sorted alphabetically by the name the *client* reports, not by uiMapID,
which is meaningless to a reader.

### Library-owned saved variables

LibDBIcon writes two keys directly into `ZoneLoreDB`: `hide` and `minimapPos`.
Neither is in `Core.lua`'s defaults table, because a default there would fight the
library. `minimapPos` is seeded once in `UI/MinimapButton.lua` so the button does
not start at angle 0 underneath other addons' buttons. ZoneLore's own
`showMinimapButton` option is authoritative and is mirrored onto `hide`.

## Options

`/zl options`, or Game Menu -> Options -> AddOns -> ZoneLore. Registered with
`Settings.RegisterCanvasLayoutCategory`, which exists on 11509 -- Leatrix_Maps,
Leatrix_Plus, Leatrix_Sounds, Syndicator and Baganator all use it.
`InterfaceOptions_AddCategory` is the legacy-only path and is deliberately not
used.

Exposed: map panel on/off, panel side, panel width, font size, hover preview
on/off, minimap button on/off, and the debug area-name reporting. Everything
applies immediately -- no reload -- via `ZoneLore:ApplyPanelOptions()`.

Widget templates were chosen from what addons already running on this client use
rather than from memory: `UICheckButtonTemplate` (`Syndicator/Options`) and
`UISliderTemplate` (`Syndicator/Options`, `Leatrix_Maps`, `Leatrix_Plus`).
`SetObeyStepOnDrag` is called behind a presence check.

### The scrollbar

`UI/TextView.lua` now draws a track and a draggable thumb, auto-hidden when the
text fits. This is hand-rolled rather than inherited from `ScrollFrameTemplate`.
That template *does* give a native bar on 11509 -- `Leatrix_Plus` uses it -- but
only through XML `KeyValues` naming a `scrollBarTemplate`, and none of that
plumbing can be checked without launching the game. For cosmetic polish a
deterministic 50 lines beat untestable inheritance. The wheel works either way.

This closes the last item left over from sidestepping
`UIPanelScrollFrameTemplate` back in M2.

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
/zl                         status for the current zone and subzone
/zl verify                  check all 49 entries against this client
/zl panel                   toggle the world map panel
/zl options                 open the settings panel
/zl window                  open the browsable lore window
/zl hover                   toggle the hover preview tooltip
/zl minimap                 show or hide the minimap button
/zl debug                   report area names on map click
/zl dump                    enumerate the map tree (dev)
```

Before logging in, `python3 tools/lua-syntax-check.py` balances block keywords and
delimiters across the addon's Lua. It is not a parser and cannot catch typos or
runtime errors, but a missing `end` otherwise costs a relog to find.

For subzones, `/zl debug` then clicking around a Tirisfal or Silverpine map prints
the raw area name, the key it normalised to, and whether lore was found — which is
how to spot a name that needs an alias. `/zl` on its own also reports the subzone
you are standing in via `GetSubZoneText()`, so mismatches can be found just by
walking around with the map closed.

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

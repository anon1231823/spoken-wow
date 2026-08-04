# ZoneLore

A World of Warcraft **Classic Era** addon that shows zone lore on the world map,
with lore text built from warcraft.wiki.gg at development time.

Target client: **Classic Era 1.15.9** (`## Interface: 11509`). Not built for
retail or the Anniversary/TBC client.

This repository holds three things: the addon, the sound packs it plays, and the
tooling that produces both.

## What ships

**`ZoneLore`** — the addon. World map side panel, subzone lore on click, hover
preview, standalone lore window, minimap button, options panel, narration
playback with floating controls, and autoplay on area discovery. 49 zones and
1304 subzones of text are bundled; nothing is fetched at runtime.

**Sound packs** — 1353 voicelines, built from the same text, shipped separately
because they are a large download. Two tiers with identical content:

| Folder | Bitrate | Zip |
|---|---|---|
| `ZoneLoreAudio` | 128 kbps (the masters) | ~790 MB |
| `ZoneLoreAudio64` | 64 kbps mono | ~400 MB |

Both can be installed at once. ZoneLore plays the higher-bitrate one and `/zl
audio` switches; see "Sound packs are self-describing" below for how it decides.

Player-facing documentation lives in `addon/ZoneLore/README.md` and
`addon/ZoneLoreAudio/README.md` — those are the CurseForge project descriptions.
Release history is in `CHANGELOG.md`.

## What is here but not shipped

**`web/`** — the voiceline explorer, for listening through takes and
regenerating the bad ones. Backed by Postgres. Deployed to lore.rusty.one via
`deploy/`; it is a working tool, not a public one.

**`tools/`** — the wiki scraper, the ElevenLabs generation pipeline, and the
validators that keep the generated Lua honest.

## Layout

```
addon/ZoneLore/          the addon itself (this is what WoW loads)
  ZoneLore.toc
  embeds.xml             loads the bundled libraries
  Core.lua               namespace, saved variables, events, zone/subzone lookup
  Audio.lua              narration playback state
  Autoplay.lua           narrate an area when the game announces its discovery
  Data/Zones.lua         GENERATED -- do not edit by hand
  Data/Subzones.lua      GENERATED -- do not edit by hand
  Sounds/placeholder.mp3 stand-in played when there is no real voiceover
  UI/TextView.lua        shared scrolling wrapped-text widget
  UI/AudioButton.lua     the Play/Stop button shown on a description
  UI/MapPanel.lua        the world map side panel
  UI/SubzoneClick.lua    resolves a map click to a subzone
  UI/HoverPreview.lua    lore tooltip while hovering the map
  UI/LoreWindow.lua      standalone browsable lore window
  UI/MinimapButton.lua   LibDBIcon minimap button
  UI/PlaybackBar.lua     floating controls, shown only while narrating
  UI/Options.lua         settings panel
  Libs/                  LibStub, CallbackHandler-1.0, LibDataBroker-1.1,
                         LibDBIcon-1.0 (copied from AI_VoiceOver_Continued)
  README.md              player-facing docs; the CurseForge description
addon/ZoneLoreAudio/     the sound pack, at master (128kbps) quality
  ZoneLoreAudio.toc      rewritten per tier at packaging time
  Data/Sounds.lua        GENERATED -- the clip lookup table
  Sounds/                GENERATED, gitignored -- the mp3s themselves
  README.md              player-facing docs; the CurseForge description
tools/
  lib/wiki.mjs           shared fetching, era filter, Lua emission
  lib/loredata.mjs       reads the generated Lua data back into JS
  voice/generate.mjs     select and synthesize voicelines (ElevenLabs)
  voice/build-lookup.mjs manifest -> ZoneLoreAudio/Data/Sounds.lua
  voice/validate-audio.mjs  manifest, files and lookup table agree
  voice/naming.mjs       line ids and file paths, derived in one place
  voice/normalise.mjs    display text -> spoken text
  voice/config.json      voice, model, output format
  voice/manifest.json    what has been generated, when, from what text
  scrape.mjs             warcraft.wiki.gg -> Data/Zones.lua
  scrape-subzones.mjs    warcraft.wiki.gg -> Data/Subzones.lua
  validate.mjs           checks the generated Lua without a Lua interpreter
  lua-syntax-check.py    block-balance check for the addon's Lua
  seed-from-dump.mjs     compares the seed against a live client map dump
  seed/zones.json        uiMapID -> wiki page title
  seed/subzones.json     which parent zones to scrape subzones for
  seed/overrides.json    hand-written zone lore that beats the scraped text
  lore/import.mjs        seed the lore_line table from the committed Lua
  lore/export.mjs        write the addon's Lua data files from lore_line
  lore/store.mjs         the seam between the lore table and the Lua files
scripts/deploy.sh        install both addons into the Classic Era AddOns folder
scripts/package.sh       build the ZoneLore zip
scripts/package-audio.sh build the sound pack zips, one per quality tier
CHANGELOG.md             release notes; the text pasted into CurseForge
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

The scraper needs Node 18+ and has no dependencies (`tools/voice/` does: `pg`, for
the explorer's database — see "The voiceline explorer"). It caches every raw API
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
**right-click** opens the settings panel. `/zl minimap` hides or shows it.

Right-click was originally a world-map-panel toggle, which is also an options
checkbox and a slash command — three ways to reach one setting, and none of them
the one people reach for on a minimap button.

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

## Narration

Every lore description carries a **Play** button — top-right of the world map
panel and of the lore window. `/zl play` narrates wherever the player is standing,
preferring the subzone over the zone when the subzone has lore of its own.

Audio ships in **separate sound-pack addons**, all of them optional. ZoneLore
looks up a clip in whichever pack is active — see "Sound packs are
self-describing" — and falls back to `Sounds/placeholder.mp3` when there is no
entry, so the button works before any voiceover exists and a missing pack sounds
wrong rather than erroring. `/zl play` says which of the two it played, and
`/zl audio` reports which packs are installed.

The placeholder is a 40-second quest line borrowed from `../wow-voiceover`'s audio
store. It is deliberately one of the longest lines there: a short clip finishes
before there is time to click anything, and the controls that appear during
playback would be untestable.

Its duration is hardcoded in `Audio.lua` as `PLACEHOLDER_DURATION`, because the
client cannot report how long a sound file is. Swap the file and that number has
to change with it.

### The beta disclaimer, and the files that carry it

The shipped voice is a first pass, and the places that describe it say so. The
wording is duplicated rather than shared, because Lua and TypeScript cannot import
from each other and a `.toc` cannot import from anything — so these are edited
together, and all of them become wrong on the same day, the day the redesigned
voice ships:

| File | Where it shows |
|---|---|
| `addon/ZoneLore/ZoneLore.toc` and `addon/ZoneLoreAudio/ZoneLoreAudio.toc` (`## Notes:`) | the in-game addon list, and the CurseForge blurb |
| `addon/ZoneLore/README.md`, `addon/ZoneLoreAudio/README.md` | the two CurseForge project descriptions |
| `web/src/lib/beta.ts` | the **beta** badge beside the logo on lore.rusty.one |

**Descriptions only, in the addon.** Nothing in the client says any of this out
loud: not `/zl audio`, not the options panel, and nothing at login or on first
playback. A player who has installed the pack has already read the description
that came with it, and an addon that repeats its own caveat into chat is an addon
that talks over the thing it is apologising for.

The site is the exception, and only because it has room to be: the badge is
silent until it is clicked, and what is behind it ends on the Support ask, for the
same reason `SUPPORT_REASON` exists — the sentence explaining that the re-record
is waiting on money is unfinished without somewhere to send the reader who wants
to do something about it.

### Autoplay on discovery

On by default: **the game's own discovery is the trigger** — the moment it prints
"Discovered Durotar", that zone's lore plays. `/zl autoplay` toggles it, and `/zl`
reports whether the feature can work at all on this client.

Subzones are included, and are most of what fires — a walk across Elwynn sets off
several. They queue rather than interrupt, so the effect is a steady trickle of
lore rather than a pile-up; the second option turns them off if it ever feels
constant.

#### Why discovery, and not "first visit"

A first attempt tracked first visits per character and got all three of its cases
wrong, for one reason: **standing in a subzone already resolves to its parent
zone.** A new orc in Valley of Trials has `GetBestMapForUnit` answering "Durotar"
from the first second, so:

- No zone-change event ever fires when they walk out into open Durotar. Nothing to
  hook.
- Anything that treats "the player's zone resolves to Durotar" as arrival consumes
  Durotar's first visit inside the starting cave, minutes before the player sees
  the zone. It then narrates Durotar while they are standing in The Den, and stays
  silent at the actual moment of discovery.

The client already tracks exploration exactly, remembers it per character across
sessions, and announces it at precisely the right instant. There is no reason to
reimplement that, and no way to reimplement it correctly.

The consequence is that a character who has already explored the world will never
autoplay anything — the discoveries have all happened. `/zl discover [area]`
simulates one, which is the only way to test this without rolling an alt.

#### The spawn area, which is never announced

Where a character starts is the one discovery the client never reports: it is
either already explored the moment the character is created, or announced while the
intro cinematic is up, before any addon has registered an event. Either way a new
orc stands in Valley of Trials in silence — which is the first thing this feature
should ever have to say.

So the spawn area is seeded two seconds after entering the world, guarded by one
per-character boolean (`ZoneLoreCharDB.greeted`). This is a greeting rather than a
rule: it fires once per character and is the only place left that infers a first
visit instead of being told about one. The cinematic needs no special handling —
the greeting queues immediately and the queue holds it until the intro ends.

The flag is set *after* the enabled check, so turning autoplay on later still
greets rather than having silently spent its turn. `/zl forget` clears it.

Because the greeting and a real discovery message can name the same area, and an
area on a zone border can be announced twice, the queue rejects a duplicate of
anything already queued or playing. Narrating something twice in a row is worse
than missing it.

#### Reading the client's own strings

The messages are matched with patterns built at runtime from `ERR_ZONE_EXPLORED_XP`
("Discovered %s: %d experience gained.") and `ERR_ZONE_EXPLORED` ("Discovered
%s."), read from the running client. Deriving the patterns from the globals rather
than hardcoding English makes this work in every locale for free, and makes a
Blizzard rewording a non-event.

Four events are watched — `CHAT_MSG_SYSTEM`, `CHAT_MSG_COMBAT_XP_GAIN`,
`UI_INFO_MESSAGE` and `UI_ERROR_MESSAGE` — because the message's route is not worth
betting on. The text lives in a global named `ERR_*`, and `ERR_` strings normally
arrive on `UI_INFO_MESSAGE`; but exploration also awards experience, which is
`CHAT_MSG_COMBAT_XP_GAIN` territory. Registering all four costs nothing, since
anything that is not a discovery fails the patterns, while betting on one costs a
play session to find out.

Their payloads are not shaped alike: `CHAT_MSG_*` put the text first, `UI_*_MESSAGE`
put a numeric message type first and the text second. Rather than encode that per
event, the handler takes whichever argument is a string.

`/zl` reports how many of the two message forms the client defined; zero means the
feature cannot fire and says so, rather than being silently dead. With `/zl debug`
on, every message arriving on any of the four events is printed with the event that
carried it — which is what to look at if discoveries are not being recognised.

### Testing autoplay

**A discovery happens once per character, ever.** Re-entering an area that has
already been explored produces no message and therefore no narration — so walking
back into The Den proves nothing, and neither does any character that has already
been played. This is the single easiest way to mistake the feature for broken.

```
/zl discover              pretend to discover the subzone you are standing in
/zl discover The Den      pretend to discover a named area
```

That runs the same path a real discovery takes, short of the message parsing. To
exercise the parsing itself, turn on `/zl debug` and walk into genuinely unexplored
ground; every message on the four watched events is printed with its event name.

`/zl forget` clears the greeting flag, so the spawn-area greeting can be heard
again on the next login without rolling another character.

#### Queue

Discoveries queue rather than interrupt, capped at 3 and dropping the oldest. The
cap matters more with subzones on: crossing a cluster of small areas can announce
several within a minute, and narration that has fallen minutes behind is describing
somewhere already left.
Combat and cinematics hold the queue rather than dropping it: the retry ticker
plays them once the pull or the intro movie ends. A starting-zone cinematic is the
one moment a character is guaranteed to be discovering things, so it is the
likeliest collision there is.

**Stop clears the queue.** Stop has to mean silence, not "skip to the next place I
discovered on the way here".

### Floating playback controls

While a clip is playing, a small **Pause / Stop** widget appears below the minimap
and disappears again when the clip ends. Drag it to move it; `/zl bar` puts it back
under the minimap; the options panel turns it off.

**Stop reads "Next" whenever autoplay has something queued**, and skips to it — with
subzone discoveries on, ending the whole backlog is rarely what is wanted mid-walk.
Stopping outright is then a **right-click**, which the tooltip says, along with how
many entries are waiting. Without that, turning Stop into Next would have removed
the only way to stop, since the queue is non-empty most of the time while
exploring.

It exists because the Play buttons are attached to a description, so they are only
reachable while that description is on screen — and narration deliberately outlives
both panels. Without this widget, closing the map would leave a clip running with
no way to stop it short of `/zl stop`.

**Pause restarts from the beginning.** The client can start and stop a sound file
and nothing in between: there is no seek, and no way to ask how far into a clip
playback has reached. `AI_VoiceOver`'s pause button has the same limitation and the
same implementation — `SoundQueue:PauseQueue` calls `Utils:StopSound`, and
`ResumeQueue` calls `PlaySound` from the top. The tooltip says so, rather than
letting the player find out forty seconds in.

It is anchored to `Minimap` rather than parented to it, so a rescaled minimap
neither drags the controls along nor changes their size.

### One clip at a time, stopped only on purpose

Starting a clip stops whatever was playing. Nothing else does: closing the map,
navigating it, walking into another zone and hiding the lore window all leave the
narration running.

Stopping when the entry scrolls out of view reads well as a rule and is wrong in
practice — the intended use is to start a zone's lore, close the map and walk,
which that rule would cut off immediately. The button always reflects the entry in
front of it, so stopping is one click, or `/zl stop`.

### Why the button resets itself from recorded data

The client fires no event when a sound finishes, so the only way the button knows
to flip back to *Play* is a duration recorded when the audio was made and shipped
alongside it. That is why durations are part of the generated lookup table rather
than an afterthought.

`PlaySoundFile` returns false both for a missing file and for a muted sound
channel. Audio.lua checks `Sound_EnableAllSound` and `Sound_Enable<Channel>` first
so the two are reported differently, which is the same distinction
`AI_VoiceOver`'s `Utils:IsSoundEnabled` exists to make.

The sound channel is configurable and defaults to **Dialog**, so narration follows
the Dialog volume slider instead of competing with it. The options panel cycles
through the five channels with a button rather than a dropdown: `UIDropDownMenu`
works on 11509, but none of its `Initialize` plumbing can be checked without
launching the game, and five values do not justify that. Same trade as the
hand-rolled scrollbar below.

## Generating voicelines

Audio is synthesized with ElevenLabs (`narrator-male`, model `eleven_v3`) and
written into the `ZoneLoreAudio` addon. **1353 lines, 672,550 characters — about
408,000 credits and 14.4 hours of audio** on this plan (see "Characters are not
credits" below).

```sh
cp .env.example .env    # then put your ELEVENLABS_API_KEY in it
```

Everything below is a **dry run** until `--generate` is added, because the
direction that cannot be undone is spending money, not printing.

```sh
node tools/voice/generate.mjs --all                     # what the whole corpus costs
node tools/voice/generate.mjs --zone Durotar            # one zone and its subzones
node tools/voice/generate.mjs --all --zones-only        # the 49 zone lines
node tools/voice/generate.mjs --missing --stale         # what needs work
```

A selection of 60 or fewer — a zone and its subzones — lists every line, largest
first, with its cost, whether it is new, stale or current, and a `short` marker on
anything under 250 characters, where v3 is least reliable. `--list` forces the
full listing for a larger selection.

```
44 lines, largest first:

  1188ch ~ 721cr  current Southfury River        1411/southfury-river
  ...
    83ch ~  50cr  current Spitescale Cavern      1411/spitescale-cavern short

  11 under 250 characters (marked "short"): v3 is least reliable there, so listen
  to those first.
```

Selectors combine, and a `--zone` takes an id or a name (`--zone 1411`,
`--zone "The Barrens"`) and pulls in that zone's subzones. `--missing` is anything
with no audio, `--stale` anything whose **spoken** text has changed since it was
made, `--older-than <date>` anything generated before then, `--limit n` caps it.

### The order to actually run it in

```sh
node tools/voice/generate.mjs --sample                  # 2 lines, then listen
node tools/voice/generate.mjs --zone Durotar --generate # 44 lines, then listen in-game
node tools/voice/build-lookup.mjs && node tools/voice/validate-audio.mjs
./scripts/deploy.sh                                     # symlinks ZoneLoreAudio too

node tools/voice/generate.mjs --all --zones-only --generate   # 49 lines, 58k chars
node tools/voice/generate.mjs --all --generate                # the remaining ~614k
```

Staging costs nothing extra — ElevenLabs bills per character either way — and it
is the only thing standing between a bad `stability` setting and 672k characters
of narration nobody has heard. `--sample` deliberately renders one long zone *and*
one entry under 250 characters, because v3 is documented as unreliable below that
length and **305 of the 1353 entries are shorter**.

Generation never overwrites existing audio without `--force`: a clip already made
cost real money and a re-roll is not always an improvement. Files are written to a
temp name and renamed, and the manifest is written after every line, so an
interrupted run keeps everything already paid for.

### How long a full run takes

Requests run in parallel, and the budget comes from **the account's plan** rather
than a constant, because ElevenLabs limits concurrency per plan and per model
family and publishes the numbers: 2 on free, 3 starter, 5 creator, 10 pro, 15
scale and business, with flash models doubled. The tier is read once from
`GET /v1/user/subscription`; `--concurrency n` overrides it.

An unrecognised or unreadable tier falls back to **2**, not to the highest —
finding out the plan is unknown must not be the moment this code is at its most
aggressive.

A 429 means the published number is wrong for right now — another process on the
same key, or a limit that moved. The budget halves and stays halved for a minute
rather than retrying into a wall, then restores itself. The limiter resizes while
requests are in flight, so this costs no restart.

The manifest is written by every worker after every line, so writes are serialised
and go through a temp file and a rename. Two concurrent writers on one path
interleave into invalid JSON, and this is the one file here that cannot be
regenerated — it is the record of everything already paid for.

### Square brackets are the one hard rule

Eleven v3 reads bracketed text as an **audio tag** — a performance direction — so
`[Deviate Fish]` would be acted rather than spoken. The lore carries 163 bracketed
spans. `tools/voice/normalise.mjs` drops IPA guides (`Kalimdor [ˈkælɪmdɔɹ]`) and
level ranges entirely, and unwraps the rest to keep the words. The generator
refuses to start if any bracket survives, and `validate-audio.mjs` checks it too.

The **spoken** text is what gets hashed into the manifest, so editing
`tools/voice/pronunciation.json` correctly marks the lines it affects as `--stale`.
That file ships empty on purpose: every rule in it is a claim that the model
mispronounces a word, and that claim can only be made after listening.

### Pronunciation: prefer the uploaded dictionary

There are two ways to fix a mispronunciation, and they are not equivalent.

`tools/voice/pronunciation.json` rewrites the text before it is sent — spelling
"Kalimdor" as "Kalimdore" and hoping. An **ElevenLabs pronunciation dictionary**
carries real IPA phoneme rules and is applied by the model, which is strictly
better where it works. Phoneme rules are honoured by `eleven_v3` and
`eleven_flash_v2` only; this project is on v3, so they apply.

`config.json` names one:

```json
"dictionaryId": "Elx0hcDze8EXW2rImeLT",
"dictionaryVersionId": null
```

Give the **id alone**. The API wants an id *and* a version, so the generator
resolves the latest version once and writes it back into `dictionaryVersionId`.
The version is pinned rather than left floating on purpose: naming a dictionary
without one would let a later upload change how already-generated lines would
sound, which is exactly what the manifest exists to make knowable. Clear both
fields to re-resolve after editing the dictionary — and note that re-resolving
does *not* mark existing lines stale, because the text did not change. Use
`--force` over the lines you want re-cut.

Every generated line records the dictionary id and version it was made with, so a
pronunciation change can be told apart from a text change after the fact.

### Characters are not credits

ElevenLabs bills `round(characters × rate)`, and **the rate belongs to the plan,
not the request**. On this account with `eleven_v3` it is **0.607**, measured over
the first 44 generated lines — so the corpus is 672,550 characters but roughly
**408,000 credits**.

That number is measured rather than assumed, because assuming it was wrong twice:
0.55 carried over from the sibling project understated the bill by 10%, and 15
characters/second understated the runtime by the same (it is 12.9). Every
generated line records what it actually cost and how long it came out, so the dry
run derives both from the manifest and says how many lines it measured over. The
`config.json` values are only the answer for an empty manifest.

The `character-cost` response header is always authoritative, and is what the
manifest stores.

### What is committed, and what is not

`tools/voice/manifest.json` (what exists, when it was made, from which text) and
`addon/ZoneLoreAudio/Data/Sounds.lua` (the generated lookup) are committed. The
mp3s are not — `addon/ZoneLoreAudio/Sounds/` is gitignored, like
`../wow-voiceover`'s `audio/`.

`tools/voice/naming.mjs` owns both the line id and the file path, and nothing else
derives either. The addon resolves clips through the lookup table, so a filename
that drifts plays silence rather than failing — which is why `validate-audio.mjs`
checks the manifest, the files on disk and the lookup table against each other, and
why `package-audio.sh` refuses to build without it.

### Bitrate is a packaging decision, not a generation one

ElevenLabs bills **characters, not bytes**, so output format does not change the
price. Audio is generated at the default 128kbps and shrunk at packaging time:

```sh
./scripts/package-audio.sh              # both tiers
./scripts/package-audio.sh standard     # just the 64kbps one
./scripts/package-audio.sh high         # just the masters
```

Generating at a low bitrate to save money would save nothing, and would make a
later quality bump a second purchase rather than a re-run. The repository holds
the masters; every shipped tier is derived from them.

### Sound packs are self-describing

A tier is an addon folder of its own — `ZoneLoreAudio` at 128kbps,
`ZoneLoreAudio64` at 64 — rather than two files under one project. One project
with two files would mean the addon manager silently "updating" a player from the
tier they chose to whichever file is newest, which is a 400MB surprise.

The full-quality pack holds the unqualified name because it is the one a player
should land on without having to make a decision first; the smaller tier names its
own trade-off, so nobody installs it wondering what "64" cost them.

Separate folders means ZoneLore cannot hardcode where the audio is. Each pack
registers itself:

```lua
ZoneLoreAudioPacks[ADDON_NAME] = pack
```

...keyed by folder name, so two installed tiers both appear instead of the second
clobbering the first. The pack reads its own folder name, quality and bitrate out
of its `.toc` through `GetAddOnMetadata` at load time, which is what lets a single
generated `Data/Sounds.lua` serve every tier — `package-audio.sh` rewrites three
`.toc` lines per tier and changes nothing else. Adding a 32kbps tier later is a
line in that script.

ZoneLore picks the highest bitrate installed unless the player has chosen
otherwise, and stores that choice as a folder name rather than an index: someone
who uninstalls the HQ pack should fall back to what remains, not to whichever
pack happens to occupy that slot afterwards.

`pack.version` is the compatibility contract, checked against `PACK_FORMAT` in
`Audio.lua`. A pack whose format this build does not know is skipped with a
message in chat, because the alternative — reading an unknown layout hopefully —
plays silence and reports nothing, which is indistinguishable from a broken
install.

## The voiceline explorer

The generator can tell you a clip exists and what it cost. It cannot tell you it
sounds *wrong*, and until `web/` there was nowhere to record that you noticed. With
1353 lines and no record of what has been heard, a listening pass cannot be resumed —
which in practice means it never gets started.

```sh
cp .env.example .env      # DATABASE_URL is already filled in; add your API key
make db-up                # Postgres on 5433, then migrations
make import               # seed from tools/voice/manifest.json (idempotent)
make web                  # http://localhost:3000
```

Browse and filter all 1353 lines, play them, flag what is wrong, fix it, regenerate.
Keys: `/` search, `space` play/pause, `j`/`k` next/previous, `f` bad, `g` ok, `u`
undo, `n` note. The pass it exists for is `?state=current&flag=unreviewed` — hold `j`
and listen, tapping `f` on anything wrong. `?flag=bad` afterwards is the worklist.

Filters live in the URL, so the back button undoes a filter change and a link carries
the exact view.

### Port 5433, not 5432

`../wow-voiceover`'s Postgres already holds 5432 on this machine, and both schemas
have a table of voicelines with a `file` column. Connecting to the wrong one silently
is the worst outcome available here.

### The database is authoritative; the manifest is an export

`voiceline_take` holds every take of every line, not just the live one, so a re-roll
that comes out worse can be undone — the superseded mp3s go to `audio-history/`
(gitignored, a *sibling* of `Sounds/` because `validate-audio.mjs` walks `Sounds/`).

`tools/voice/manifest.json` is still committed and is still what `build-lookup.mjs`
turns into the addon's lookup table. It stopped being hand-maintained and became an
export: `make lookup` runs `export-manifest.mjs` before `build-lookup.mjs`. **The
addon build never learns the database exists** — with `DATABASE_URL` unset every tool
falls back to the file and a clone with no Postgres can still generate audio and ship
the addon.

The seam is `tools/voice/store.mjs`, which already owned `loadManifest`/`saveManifest`
and is the only way the other tools reach that state. Putting Postgres behind those
two functions is what keeps the CLI and the web app writing the same rows.
`../wow-voiceover/web/migrations/0012` records the alternative: *"the Python CLI reads
the corpus and will not see these rows… The web app is the generation path. This is
recorded rather than solved."*

The check that proves it: `make import && make export` must leave `manifest.json`
byte-identical, and `validate-audio.mjs` must still pass.

### Regenerating costs money, so it says so first

One line goes straight through — it is one click, it is cheap, and the archive makes
it reversible. Anything larger quotes first, priced from `measureRates()`, the same
0.607 credits/character measured over real billing that the CLI's dry run uses.

The web app imports `tools/voice/elevenlabs.mjs` directly rather than spawning the
CLI, so the typed failure kinds and the `character-cost` header reach the take row
instead of being parsed back out of stdout. This needs `outputFileTracingRoot` in
`web/next.config.ts` pointed at the repo root, without which Next traces dependencies
from `web/` alone and leaves `tools/` out of the build.

Batches run in-process with progress in memory — no queue tables. Those exist in
`../wow-voiceover` because two pm2 workers share one billing account; here there is
one process. The work is server-side so closing the tab does not strand it. A server
restart does, and that is a real limitation rather than one worth engineering around.

### Deployed at lore.rusty.one

Pushing to `master` deploys the explorer to a DigitalOcean droplet — the same one
`../wow-voiceover` runs on, beside it rather than tangled with it: its own `/srv` tree,
its own database, its own pm2 app, and **port 3001**, because voiceover holds 3000.
CI builds and tests, ships a Next.js `standalone` bundle, and swaps a symlink;
`deploy/README.md` is the full account, including first-time droplet setup.

**The site is public to read and closed to write.** Anyone may browse, filter and listen —
that is why it is hosted at all. Everything else needs an account *and* a role:

| Role | May |
|---|---|
| *(nobody)* | browse, filter, search, play, download a clip, **file feedback** |
| `member` | exactly the same. Registering grants nothing |
| `editor` | flag lines and write notes; Regenerate, which spends credits; Restore; read and resolve feedback |
| `admin` | also edit the pronunciation rules, and grant these roles at `/admin` |

`member` doing nothing is the point: the site is reachable from the internet, so anything
a fresh registration unlocked would be unlocked for everyone. The first admin is promoted
with one line of SQL — see `deploy/README.md` — because "the first account wins" is a race
anyone could enter.

The roles are defined once in `web/src/lib/permissions.ts` and shared by the browser and
the server. What the browser decides is only what to draw; `web/src/lib/authz.ts` decides
what actually happens, and does it again on every request. Leaving `ELEVENLABS_API_KEY` out
of the droplet's `app.env` closes off the expensive half regardless of anyone's role.

The one thing worth knowing here rather than there: **`tools/` paths are overridable by
environment variable, and on the droplet all five are overridden.** Every path under
`tools/` derives from `ROOT` in `tools/lib/loredata.mjs`, which is the module's own
location — and cannot be, once webpack has compiled it, because webpack replaces
`import.meta.url` at *build* time. A bundle built in CI otherwise looks for the lore
corpus under a GitHub runner's checkout path. So a deployed process is told instead:

| | |
|---|---|
| `ZONELORE_ROOT` | the release directory — corpus and voice config move with a rollback |
| `ZONELORE_SOUNDS` | shared, so ~700MB is not copied per deploy or deleted by a prune |
| `ZONELORE_AUDIO_HISTORY` | shared; this one's loss is permanent |
| `ZONELORE_MANIFEST` | shared; write-only, since the database is authoritative |
| `ZONELORE_PRONUNCIATION` | shared, because `/lexicon` writes it |

Unset — every local run, CLI or `next dev` — each falls back to exactly the path it
always had. Nothing about working locally changes.

### Feedback is the one thing the world may write

Filing feedback is the single exception to "public to read, closed to write", and it is
the exception the rest of the table exists to make safe. A visitor who hears a
mispronunciation or spots a Cataclysm sentence the era filter let through is the cheapest
source of corrections this project has, and before `feedback` they had nowhere to put it.

Two entry points, both open to anyone signed in or not: the **Feedback** button in the
header, for anything that is about no particular line, and a small ✍ button in each row's
State column, for a report against that line. A category is asked for up front — lore,
audio, pronunciation, other — because it decides who looks: pronunciation is a `/lexicon`
rule, audio is a re-roll, lore is the scraper or an override. Name and email are offered
and optional; submitting anonymously is expected and fine. A signed-in reporter is
identified by their account and is not asked.

Editors and admins read them at **`/feedback`**, newest first, filtered to `open`,
`resolved` or `all`, and close each one as **not an issue** or **fixed** — a report is a
claim, not a verdict, so "not an issue" is a normal outcome. Reopening is always possible.
The same reports also expand inline in the explorer, and `?fb=open` narrows the table to
lines carrying an unresolved one.

**`feedback` is a separate table from `line_flag`, not a status on it.** They look alike
and are not the same thing: a flag is one editor's verdict and is the regeneration
worklist, whereas a report is one visitor's claim and there can be several per line.
Folding them together would mean either letting a passer-by write the worklist or
throwing away what the passer-by had to say, and it could not hold "three people
independently reported this line", which is the most useful signal here.

**Open counts are public; report bodies are not.** The badge on a row and the `?fb=open`
filter travel with the search results, because "someone has already reported this one" is
the answer to the question a dissatisfied listener is about to ask — the same reason the
`bad` badge is visible to a guest. The prose behind it is behind `requireFeedback()`.

Two things stand between `POST /api/feedback` and the internet: a honeypot field a person
never sees and a bot fills in — answered with `200` and no row, because a `400` teaches
the script to stop sending it — and a cap of ten submissions per IP per hour, counted in
Postgres rather than in memory so it survives a pm2 restart. Resolving lives at
`/api/feedback/resolve`, its own route rather than another action on the public one:
two verbs on one path with opposite access rules is an arrangement a later edit quietly
breaks.

### Moving the audio between machines

1353 mp3s, ~795MB, gitignored and never in CI. `DROPLET` defaults to
`deploy@rusty.one`; override it for anywhere else.

```sh
make audio-status     # local and droplet, side by side
make pull-dry         # what `make pull` would change
make pull             # the audio the droplet regenerated
make db-pull          # the takes and flags behind it
make lookup           # rebuild Sounds.lua from the manifest
```

Both `push` and `pull` use `--delete` and both show a dry run and ask first: the
droplet is a second copy, not a backup, and since regeneration happens through the web
UI it is usually the *newer* side.

No `-z`: mp3 is already compressed, so it is pure CPU for nothing. The rsync-3.x
preflight is load-bearing — macOS ships openrsync as `/usr/bin/rsync`, which reports
itself as "2.6.9 compatible" and rejects `--info`.

`audio-history/` grows without bound: re-cutting the whole corpus adds another ~795MB.
There is no prune command yet.

## Options

`/zl options`, or Game Menu -> Options -> AddOns -> ZoneLore. Registered with
`Settings.RegisterCanvasLayoutCategory`, which exists on 11509 -- Leatrix_Maps,
Leatrix_Plus, Leatrix_Sounds, Syndicator and Baganator all use it.
`InterfaceOptions_AddCategory` is the legacy-only path and is deliberately not
used.

Exposed: map panel on/off, panel side, panel width, font size, hover preview
on/off, minimap button on/off, narration on/off, autoplay on/off, autoplay for
subzones on/off, the playback controls on/off, the narration sound channel, and the
debug area-name reporting. Everything applies immediately -- no reload -- via
`ZoneLore:ApplyPanelOptions()`.

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

### Fixing a line by hand

Rewrite it in the explorer. The pencil beside a line opens its text, and saving
records a new version in `lore_line` — the corpus lives in the database so that
the person who notices a bad line is the person who can fix it, without a
checkout. Editors and admins may do this; it costs nothing, and the rewritten
line simply becomes stale, joining the regeneration worklist rather than spending
credits on the spot.

Getting that into the addon is one command and a commit:

```
make lore-export        # rewrite addon/ZoneLore/Data/*.lua from the database
git diff addon/ZoneLore/Data/
make lookup             # only if the text moved and the audio was regenerated
```

`make lore-check` answers the other direction — whether the committed Lua still
matches the database.

A re-scrape never takes a hand edit back. `node tools/scrape.mjs` records what
the wiki says now as a new version, but a line whose live version was edited
keeps that edit; the wiki text waits in the history for someone to compare and
promote. That is what makes re-scraping safe to run.

`tools/seed/overrides.json` still exists and still wins over scraped text for
**zones**, keyed by uiMapID. It is the right place for lore that should survive a
rebuild of the database from a fresh scrape; the explorer is the right place for
everything else.

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
/zl play                    narrate the lore for where you are standing
/zl stop                    stop the narration
/zl voice                   turn narration on or off
/zl audio                   list sound packs, or switch with /zl audio <name>
/zl autoplay                toggle narrating areas as you discover them
/zl discover [area]         pretend to discover an area (dev)
/zl forget                  replay the login greeting on next login (dev)
/zl bar                     move the playback controls back below the minimap
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
`WorldMapFrame` and contends for the same area-label script the hover preview
uses.

## Releasing

Three CurseForge projects, released on their own cadences: most ZoneLore releases
do not touch a voiceline, and the packs should not re-upload 400MB for a Lua fix.

```sh
make package                    # dist/ZoneLore-<version>.zip
make package-audio              # dist/ZoneLoreAudio-<v>.zip + ZoneLoreAudio64-<v>.zip
```

`make package` refuses to build from a dirty `addon/` tree, so a zip can always be
traced back to a commit. Both scripts unpack to the addon folder itself, which is
what the addon hosts expect — check with `unzip -l` if that ever seems in doubt.

**Versioning.** All three carry the same version, bumped together in their
`.toc`s. ZoneLore and a pack interoperate as long as their **major versions
match**; `PACK_FORMAT` in `Audio.lua` is the machine-checkable half of that rule
and is bumped only alongside a major.

**Per release:** bump the `.toc`s, add a `CHANGELOG.md` entry, commit, tag
`v<version>`, build, then upload:

```sh
make release-dry                # what would be sent, sending nothing
make release                    # all three
./scripts/release.sh zonelore   # or one at a time
```

`scripts/release.sh` posts to the CurseForge author API. It needs
`CURSEFORGE_TOKEN` in `.env` — an account-wide token from
[the API tokens page](https://authors-old.curseforge.com/account/api-tokens),
not a per-project one, so one token covers all three.

The project IDs live in the script. Three things it derives rather than repeats:
the version comes from the `.toc` being uploaded, the zip is whatever
`package*.sh` named for that version, and the release notes are the matching
`## <version>` section of `CHANGELOG.md` — sent as markdown, so the notes on the
site cannot drift from the ones in the repository.

The game version is resolved by **name** (`1.15.9`) against
`/api/game/versions` at upload time rather than being hardcoded as the numeric ID
the API actually wants. That ID is undocumented, and a wrong one produces a file
filed against the wrong client, which players experience as the addon not
appearing in their AddOns list at all. `GAME_VERSION_NAME=` overrides it.

Uploads go out as CurseForge release type `release`, which is not the same claim
as the beta disclaimer in the descriptions: marking the files `beta` would stop
most addon managers offering them to players on the default channel, which is the
audience this is for. `RELEASE_TYPE=beta` overrides it.

### Descriptions live in `curseforge/`, and are pasted by hand

CurseForge has **no API for project descriptions, summaries or categories** —
`upload-file` is the only write endpoint it offers, and metadata editing is an
open feature request rather than a thing. A project page is updated by pasting
into a web form, so the only question is where the pasted text comes from.

It comes from `curseforge/<slug>.md`. The frontmatter is everything the form asks
for besides the body — project id, summary, categories, tags, license — and the
body is the description. `tools/descriptions.mjs` generates two things from it:

```sh
make descriptions          # addon READMEs + dist/descriptions/ to paste from
make descriptions-check     # part of `make check`
```

The addon README that ships inside each zip is generated from the same body, so
the page a player reads before installing and the file they get afterwards cannot
say different things. Those READMEs are generated files and carry the usual
warning at the top; `make check` fails if one has been edited by hand.

Nothing here can read the site back, so `curseforge/published.json` records a hash
of each description at the moment it was pasted. `make descriptions-published`
says "what is in the repository is now what is on the site" — run it *after*
pasting, since nothing can verify the claim. `scripts/release.sh` prints anything
that has drifted, at the one moment you already have the project pages open.

**What the script deliberately does not do** is create projects or set relations.
Those are one-time settings, and a script that rewrote them on every release would
be one that could quietly undo an edit made in the UI.

**Relations to set on each project once, by hand:** ZoneLore lists both packs as
optional dependencies; each pack lists ZoneLore as a required dependency; ZoneLore
lists LibStub, CallbackHandler-1.0, LibDataBroker-1.1 and LibDBIcon-1.0 as
includes, since they are embedded under `Libs/` rather than fetched.

## Licensing

Addon code: MIT.

Zone lore text in `addon/ZoneLore/Data/Zones.lua` and `Data/Subzones.lua` is
derived from [warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed
**CC BY-SA 4.0**; each entry carries a `source` URL to its page. The narration in
the sound packs is generated from that text and carries the same license. Any
distribution must keep that attribution and license the lore data and audio under
CC BY-SA. Text in `tools/seed/overrides.json` is original and not covered by that,
and so is any entry the data files emit with an empty `source` — a line rewritten
in the explorer keeps the source of the text it was derived from, because an edit
of wiki prose is still a derivative of it, so an empty `source` means the entry
has no wiki ancestor at all.

All three CurseForge projects declare **MIT** in the license dropdown, which is
the code half of that and the closest single entry the field offers. The wiki's
attribution and share-alike terms are carried in the description body instead —
every project page ends on a Credits section naming warcraft.wiki.gg and CC BY-SA
4.0, which is why those sections are not optional trimming when a page gets
rewritten.

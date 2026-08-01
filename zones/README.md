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
| M6 narration playback + autoplay on discovery | done, tested in-game |
| M7 voiceline generation tool | done, **no audio generated yet** |

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
addon/ZoneLoreAudio/     the optional voiceover companion addon
  ZoneLoreAudio.toc
  Data/Sounds.lua        GENERATED -- the clip lookup table
  Sounds/                GENERATED, gitignored -- the mp3s themselves
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
  seed/overrides.json    hand-written lore that beats the scraped text
scripts/deploy.sh        install both addons into the Classic Era AddOns folder
scripts/package.sh       build the ZoneLore zip
scripts/package-audio.sh build the ZoneLoreAudio zip, optionally transcoded
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

Audio ships in a **separate `ZoneLoreAudio` addon**, which is optional. ZoneLore
looks up a clip in the global `ZoneLoreAudioData` table that addon defines, and
falls back to `Sounds/placeholder.mp3` when there is no entry — so the button
works before any voiceover exists, and a missing soundpack sounds wrong rather
than erroring. `/zl play` says which of the two it played.

The placeholder is a 40-second quest line borrowed from `../wow-voiceover`'s audio
store. It is deliberately one of the longest lines there: a short clip finishes
before there is time to click anything, and the controls that appear during
playback would be untestable.

Its duration is hardcoded in `Audio.lua` as `PLACEHOLDER_DURATION`, because the
client cannot report how long a sound file is. Swap the file and that number has
to change with it.

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
written into the `ZoneLoreAudio` addon. **1353 lines, 672,550 characters.**

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
./scripts/package-audio.sh              # ship the masters (~700MB)
BITRATE=64 ./scripts/package-audio.sh   # transcode on the way in (~360MB)
```

Generating at a low bitrate to save money would save nothing, and would make a
later quality bump a second purchase rather than a re-run.

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
/zl play                    narrate the lore for where you are standing
/zl stop                    stop the narration
/zl voice                   turn narration on or off
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
`WorldMapFrame` and will contend for the same area-label script once M3 lands.

## Licensing

Addon code: MIT.

Zone lore text in `addon/ZoneLore/Data/Zones.lua` is derived from
[warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed
**CC BY-SA 4.0**; each entry carries a `source` URL to its page. Any distribution
of this addon must keep that attribution and license the lore data under CC BY-SA.
Text in `tools/seed/overrides.json` is original and not covered by that.

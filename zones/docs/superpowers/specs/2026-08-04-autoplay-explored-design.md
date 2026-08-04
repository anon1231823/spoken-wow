# Narrating areas the character already explored

## The problem

Autoplay is triggered by the client's own discovery message — the moment it prints
"Discovered Durotar". `Autoplay.lua` explains why: zone-change events do not fire at the
right moment for a fresh character, and tracking first visits ourselves means guessing at
when a visit starts, while the game already knows exactly and remembers it per character
for free.

That reasoning holds, and it has one consequence nobody wanted: a character who explored
Azeroth before installing ZoneLore is never narrated anything. The client fires a
discovery once per character, ever. For a level 60, all of those fired years ago. The
addon is silent on a character who would most enjoy it, and there is no setting that
changes that.

## The shape

An option that says "do not ask the client, keep the record yourself". When it is on,
ZoneLore stores which areas this character has heard and narrates on entry rather than on
discovery — still once per area, per character.

For a fresh character this changes nothing observable. The discovery message arrives on
first entry exactly as it does today, narrates, and marks the area heard; the override
then has nothing left to say about it. The option exists only to give an explored
character the same sequence a fresh one would have had, spread across wherever they
happen to travel.

```
discovery message ─┐
                   ├→ Enqueue → Drain → PlayLore → mark heard in ZoneLoreCharDB
zone change ───────┘                                        ↑
(override only, when the area is not in that record)  ───────┘
```

### Decisions

**Zones and subzones both, honoring `autoplaySubzones`.** The volume argument against
subzones does not survive contact with "once per character": an explored 60 hears exactly
the set a fresh character hears, no more. The only real difference is pacing — a 60 riding
across Stranglethorn crosses ten never-narrated subzones in two minutes, where a leveler
met them over days.

**An area is marked heard when playback starts, not when it is queued.** `QUEUE_LIMIT` is
3, so that ride across Stranglethorn drops most of what it queues. Marking on entry would
silently spend those areas and the player would never hear them. Marking on playback
leaves them eligible, so riding back through later picks up what got skipped. The cost is
that a place passed through weeks ago can narrate late, which is a much smaller loss than
content silently consumed.

**Any successful `PlayLore` marks, whatever started it.** A discovery-triggered clip, an
override clip, and a manual click on the map panel all consume the area's one turn. This
is what keeps the discovery path and the override from both narrating the same area on
the same entry, and it gives the right answer for the manual case too: the player just
heard it.

**Turning the option on does not fire retroactively.** It takes effect on the next zone
change or the next login, not at the moment the checkbox is ticked. A settings panel
should not start talking.

**The record is per character; the setting is account-wide.** `ZoneLoreCharDB` already
holds the `greeted` flag for the same reason — what a character has heard is not a
preference.

## Components

**`Core.lua`** — `autoplayExplored = false` in the defaults table.

**`Autoplay.lua`** — owns the record and the new trigger:

- `ZoneLoreCharDB.heard`, keyed `mapID` for a zone and `mapID .. "/" .. areaKey` for a
  subzone.
- `ZoneLore:MarkHeard(mapID, areaKey)` and a `HasHeard` predicate.
- A `zoneChangedCallbacks` registration. `Core.lua:383` already dispatches those from
  `ZONE_CHANGED`, `ZONE_CHANGED_INDOORS` and `ZONE_CHANGED_NEW_AREA`, which covers subzone
  transitions as well as zone ones. On fire, with the option on: enqueue the zone if
  unheard, then the subzone if unheard and `autoplaySubzones` is on. Entering a new zone
  at a subzone queues both, zone first.
- The same check on the existing `LOGIN_SEED_DELAY` timer, so logging in and standing
  still is not silent.
- `ForgetGreeting` grows into a reset that clears `heard` as well as `greeted`.

**`Audio.lua`** — `PlayLore` calls `MarkHeard` once playback is confirmed started.

**`UI/Options.lua`** — a checkbox at the same indent as "Also narrate subzones you
discover": *"Also narrate areas you explored before installing ZoneLore"*. The tooltip
says the game announces a discovery only once per character ever, so a character who
already explored Azeroth hears nothing; ticking this makes ZoneLore keep its own record
instead, still one clip per area per character.

**`/zl forget`** — clears the record, for a player who wants to hear it again and for
testing this without rolling a character. `Autoplay.lua` already notes that every test of
this feature otherwise costs a fresh character.

**`DescribeAutoplay`** — reports the option's state and how many areas are on record, so
"nothing has happened yet" can be told apart from "everything here is already marked".

## Verification

`make check`. Nothing here touches the sound packs, the generated data, or the explorer,
so `make validate-audio` and the tooling are unaffected.

In-game behavior is not verifiable from a development machine. What wants a play session:
that a zone-change fires the override on an explored character, that a fresh character
sees no change, and that the queue does not double up when a discovery message and a zone
change land together.

## Versioning

A patch bump on `addon/ZoneLore/ZoneLore.toc` and its `CHANGELOG.md` section. This is a
control added to a screen that already exists, not a new surface. The sound packs are
untouched and `ZoneLoreAudio.toc` does not move.

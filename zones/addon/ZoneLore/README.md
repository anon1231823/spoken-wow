# ZoneLore

Zone lore on the world map, for **WoW Classic Era**.

Open the map and the lore of the zone you are looking at appears beside it. Click
a named subzone and you get that place's story instead. Optionally, it is read
aloud.

Everything is bundled — 49 zones and 1304 subzones of text, built from
warcraft.wiki.gg and filtered to what actually exists in Classic Era. Nothing is
fetched at runtime.

## What it does

- **World map panel** — the current zone's lore beside the map. Dock it left or
  right, resize it, set the font size.
- **Subzone lore** — click any named area on the map to read about it.
- **Hover preview** — point at a subzone for the first lines in a tooltip,
  without disturbing the panel.
- **Lore window** — browse zones without opening the map. `/zl window`, or the
  minimap button.
- **Narration** — a play button beside the lore, with floating pause/skip/stop
  controls. Requires a sound pack; see below.
- **Autoplay** — walking into an area you have never discovered narrates it once,
  tracked per character.

## Narration needs a sound pack

The voice audio is a large download, so it ships as a separate addon. ZoneLore
works fine without one — you just read rather than listen — and falls back to a
placeholder clip so the controls still behave.

Two packs are available. They contain the same 1353 voicelines and differ only in
bitrate:

| Pack | Bitrate | Download |
|---|---|---|
| **ZoneLore Audio** (`ZoneLoreAudio`) | 128 kbps | ~790 MB |
| **ZoneLore Audio 64** (`ZoneLoreAudio64`) | 64 kbps mono | ~400 MB |

Install either — ZoneLore Audio unless the download is a problem, in which case
the 64 kbps pack is half the size and close to transparent for speech. If you
install both, ZoneLore plays the higher-quality one; `/zl audio` lists what you
have and switches between them.

### The voice is in beta

What is in the packs today is a **proof of concept**. All 1353 lines are
recorded, but the voice is being redesigned — better delivery, consistent
pronunciation, one pass over the whole script — which means generating every line
again. That costs money per line and time to check, so it lands in batches rather
than all at once.

If a line reads badly, report it on [lore.rusty.one](https://lore.rusty.one); the
re-record follows what comes in.

## Commands

```
/zl              status for the current zone and subzone
/zl options      open the settings panel
/zl window       open the browsable lore window
/zl panel        toggle the world map panel
/zl hover        toggle the hover preview tooltip
/zl play         read the current lore aloud
/zl stop         stop the narration
/zl voice        toggle narration on or off
/zl audio        list sound packs, or /zl audio <name> to switch
/zl autoplay     toggle narrating areas as you discover them
/zl bar          move the playback controls back below the minimap
/zl minimap      show or hide the minimap button
/zl help         the full list, including developer commands
```

## Compatibility

Built for **Classic Era 1.15.9** (`Interface 11509`). Not built for retail or the
Anniversary/TBC clients.

ZoneLore and a sound pack work together as long as they share a **major
version** — 0.2.x ZoneLore reads any 0.x pack. Mixing across a major version
boundary makes ZoneLore say so in chat rather than quietly playing nothing.

## Credits and licensing

Addon code is **MIT**.

Zone and subzone lore text is derived from
[warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed **CC BY-SA 4.0**, as
is the narration generated from it. Thanks to the wiki's contributors, without
whom this addon is an empty frame.

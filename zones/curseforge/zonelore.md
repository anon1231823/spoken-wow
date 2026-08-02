---
project: 1636521
slug: zonelore
name: ZoneLore
summary: Zone lore on the world map. Open the map and read the story of the zone you're looking at, or click any subzone for its own. 49 zones, 1304 subzones, optionally narrated.
categories:
  - Map & Minimap
tags:
  - lore
  - world map
  - immersion
  - classic era
license: custom
addonReadme: addon/ZoneLore/README.md
---

# ZoneLore

**Zone lore on the world map, for WoW Classic Era.**

Open the map and the lore of the zone you're looking at appears beside it. Click a
named subzone and you get that place's story instead. Optionally, it's read aloud.

Everything is bundled — 49 zones and 1304 subzones of text, built from
warcraft.wiki.gg and filtered to what actually exists in Classic Era. Nothing is
fetched at runtime, and there's no setup.

## ZoneLore is in beta

Everything works end to end — every Classic Era zone and subzone has lore, and all
1353 lines of it are narrated. What it isn't yet is finished. Two things are still
being worked on:

**The lore text.** It's built by scraping warcraft.wiki.gg and trimming each
article down automatically. Mostly that produces something good, but some entries
run long, some are thinner than the place deserves, and a few are cut at an
awkward point. The filter that strips post-vanilla content is careful but not
perfect. Hand-written replacements are gradually going in for the worst of them.

**The voice.** It was picked to get all 1353 lines recorded at once, not because
it's the right one. Delivery is flat in long descriptions and names aren't
pronounced consistently between lines. That isn't fixable entry by entry — it's a
different voice and a fresh pass over the whole script, which means generating
every line again. Each costs money to synthesise and time to check, so it lands in
batches.

If an entry reads badly — the text or the narration — report it on
[lore.rusty.one](https://lore.rusty.one). Corrections are driven by what comes in.
If you'd like it to move faster, [supporting the
project](https://buymeacoffee.com/rustykey) pays for it directly.

## What it does

- **World map panel** — the current zone's lore beside the map. Dock it left or
  right, resize it, set the font size.
- **Subzone lore** — click any named area on the map to read about it.
- **Hover preview** — point at a subzone for the first lines in a tooltip, without
  disturbing the panel.
- **Lore window** — browse zones without opening the map, from the minimap button
  or `/zl window`.
- **Narration** — a play button beside the lore, with floating pause/skip/stop
  controls.
- **Autoplay** — walking into an area you've never discovered narrates it once,
  tracked per character.

## Narration needs a sound pack

The voice audio is a large download, so it ships separately. **ZoneLore works fine
without one** — you read rather than listen — and falls back to a placeholder clip
so the controls still behave.

Two packs, same 1353 voicelines, differing only in bitrate:

| Pack | Bitrate | Download |
|---|---|---|
| **ZoneLore Audio** | 128 kbps | ~790 MB |
| **ZoneLore Audio 64** | 64 kbps mono | ~400 MB |

Install ZoneLore Audio unless the download is a problem, in which case the 64 kbps
pack is half the size and close to transparent for speech. With both installed
ZoneLore plays the higher-quality one; `/zl audio` lists what you have and
switches between them.

## Commands

```
/zl              status for the current zone and subzone
/zl options      open the settings panel
/zl window       open the browsable lore window
/zl panel        toggle the world map panel
/zl hover        toggle the hover preview tooltip
/zl play         read the current lore aloud
/zl voice        toggle narration on or off
/zl audio        list sound packs, or switch between them
/zl autoplay     toggle narrating areas as you discover them
/zl minimap      show or hide the minimap button
/zl help         the full list
```

## Compatibility

Built for **Classic Era 1.15.9** (`Interface 11509`). Not built for retail or the
Anniversary/TBC clients.

ZoneLore and a sound pack work together as long as they share a major version.

## Support

The lore text is free and always will be. The narration isn't free to make — every
line costs money to synthesise. If the addon is worth something to you, [buy me a
coffee](https://buymeacoffee.com/rustykey); it goes straight into re-recording the
voice.

## Credits and licensing

Addon code is **MIT**.

Zone and subzone lore text is derived from
[warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed **CC BY-SA 4.0**, as
is the narration generated from it. Thanks to the wiki's contributors — without
them this addon is an empty frame.

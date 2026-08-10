<!-- GENERATED from curseforge/zonelore.md by tools/descriptions.mjs. Do not edit by hand. -->

**Zone lore on the world map, for WoW Classic Era.**

Open the map and the lore of the zone you're looking at appears beside it. Click a named subzone and you get that place's story instead. Optionally, it's read aloud.

## The lore, as of 0.3.0

**The lore text** starts from warcraft.wiki.gg and was rewritten across the whole corpus to describe the world as a vanilla character finds it: post-vanilla world state, quest outcomes told as settled history, and game-mechanical phrasing were taken out, over several full review passes. The wiki is written for a modern reader, though, and with this many places some of it will still slip through. If an entry reads wrong — later-expansion lore, a resolved conflict your character can plainly see unresolved, a fourth-wall break — the **Report** button on the entry is the fastest way to say so; reports decide what gets fixed first.

## What it does

- **World map panel** — the current zone's lore beside the map. Dock it left or right, resize it, set the font size.
- **Subzone lore** — click any named area on the map to read about it.
- **Hover preview** — point at a subzone for the first lines in a tooltip, without disturbing the panel.
- **Lore window** — browse zones without opening the map, from the minimap button or `/zl window`.
- **Narration** — a play button beside the lore, with floating pause/skip/stop controls.
- **Autoplay** — walking into an area you've never discovered narrates it once, tracked per character. Already explored the world? A setting narrates those areas too, still once each.
- **Report a problem** — a Report button on every entry and on the playback controls. The game can't open a browser, so it hands you a short link to that exact line; the page at the other end has the text, the audio and a form.

## Narration needs a sound pack

The voice audio is a large download, so it ships separately. **ZoneLore works fine without one** — you read rather than listen — and falls back to a placeholder clip so the controls still behave.

Two packs, the same voicelines — and there are a lot of them — differing only in quality:

| Pack | Bitrate | Download |
|---|---|---|
| **ZoneLore Audio** | 128 kbps | ~450 MB |
| **ZoneLore Audio 64** | VBR mono | ~220 MB |

Install ZoneLore Audio unless the download is a problem, in which case ZoneLore Audio 64 is half the size and close to transparent for speech. With both installed ZoneLore plays the higher-quality one; `/zl audio` lists what you have and switches between them.

### The voice

As of 0.3.0 every line is recorded with a new narrator, and NPC and place names go through a pronunciation dictionary so they sound the same everywhere they appear. With this many lines some readings will still land flat or a name will come out wrong — press **Report** while you are hearing it; the playback controls carry the button, so you don't have to go and find the entry again. Per-line fixes follow what comes in, and [supporting the project](https://buymeacoffee.com/rustykey) pays for that generation directly.

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

Built for **Classic Era 1.15.9** and the **Anniversary client (2.5.6)**. Not built for retail.

The lore covers vanilla Azeroth, which is where an Anniversary character spends most of their levelling. Outland and the blood elf and draenei starting zones have no lore yet — the panel is empty there rather than wrong.

ZoneLore and a sound pack work together as long as they share a major version.

## Support

The narration isn't free to make — every line costs money to synthesise. If the addon is worth something to you, [buy me a coffee](https://buymeacoffee.com/rustykey); it goes straight into fixing reported lines.

## Credits

Zone and subzone lore text is derived from [warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed **CC BY-SA 4.0**, as is the narration generated from it. Thanks to the wiki's contributors — without them this addon is an empty frame.

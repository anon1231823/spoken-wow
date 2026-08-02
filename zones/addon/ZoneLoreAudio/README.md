# ZoneLore Audio

Narrated zone lore for [ZoneLore](https://www.curseforge.com/wow/addons/zonelore).
This addon is data only — it does nothing on its own.

1353 voicelines covering all 49 Classic Era zones and 1304 subzones, generated
with ElevenLabs from the same warcraft.wiki.gg text ZoneLore displays.

## Which pack to install

Two packs exist, with identical content at different bitrates. Install one:

| Pack | Bitrate | Download |
|---|---|---|
| **ZoneLore Audio** (`ZoneLoreAudio`) | 64 kbps mono | ~400 MB |
| **ZoneLore Audio HQ** (`ZoneLoreAudioHQ`) | 128 kbps | ~790 MB |

64 kbps mono is close to transparent for speech and half the download. Take the
HQ pack if disk and bandwidth are free and you would rather not wonder.

Both can be installed at once — ZoneLore plays the higher-quality one, and
`/zl audio` switches between them.

## Installing

Install ZoneLore first; this pack is inert without it. Extract into
`Interface/AddOns` so the folder sits alongside `ZoneLore`, and leave the folder
name as shipped — ZoneLore finds packs by folder name.

Neither addon declares a hard dependency on the other, so the order you install
them in does not matter.

## Compatibility

Built for **Classic Era 1.15.9** (`Interface 11509`).

The pack and ZoneLore work together as long as they share a **major version** —
any 0.x pack works with 0.x ZoneLore. Handed a pack from across a major version
boundary, ZoneLore says so in chat rather than quietly playing nothing.

## Licensing

The narration is generated from lore text derived from
[warcraft.wiki.gg](https://warcraft.wiki.gg) and carries that text's
**CC BY-SA 4.0** license. Attribution: warcraft.wiki.gg contributors.

# Changelog

Notable changes to ZoneLore and its sound packs. Both are versioned together:
see [Compatibility](#compatibility) below.

## 0.2.0 — 2026-08-02

First public release.

ZoneLore shows the lore of the zone you are looking at, and reads it aloud.

**On the world map**

- A side panel on the world map carrying the lore of the zone in view. Dockable
  left or right, resizable, with an adjustable font size.
- Click a named subzone on the map to read its lore instead of the zone's. 1304
  subzones across 46 zones are covered.
- A hover preview: point at a subzone and the first lines appear in a tooltip,
  without changing what the panel is showing.

**Elsewhere**

- A standalone lore window for browsing zones without opening the map, reachable
  from the minimap button or `/zl window`.
- A minimap button, movable around the ring and hideable.
- An options panel under the game's own settings, or `/zl options`.

**Narration**

- Every zone and subzone entry is narrated — 1353 voicelines. Playback is a
  button beside the lore itself, with floating controls for pause, skip and stop.
- Autoplay: entering an area you have never discovered narrates it once. It stays
  discovered per character.
- Narration plays on the Dialog channel by default, so it rides the dialog volume
  slider rather than competing with it. Configurable.
- Audio ships separately, as a **sound pack** addon. ZoneLore works without one —
  the lore text is all in ZoneLore itself — and falls back to a placeholder clip
  so the playback controls still behave.

**Sound packs**

Two tiers, differing only in bitrate. Install either, or both:

| Pack | Bitrate | Download |
|---|---|---|
| `ZoneLoreAudio` | 128 kbps | ~790 MB |
| `ZoneLoreAudio64` | 64 kbps mono | ~400 MB |

With both installed, ZoneLore plays the higher-quality one. `/zl audio` lists
what is installed and switches between them.

**Data**

- 49 zones and 1304 subzones, built from warcraft.wiki.gg and filtered to what
  exists in Classic Era — no content from later expansions leaks in.

### Compatibility

- Client: **Classic Era 1.15.9** (`Interface 11509`). Not built for retail or the
  Anniversary/TBC clients.
- ZoneLore and a sound pack work together as long as they share a **major
  version**. 0.2.x ZoneLore reads any 0.x pack; a 1.x pack needs 1.x ZoneLore.
  ZoneLore says so in chat rather than going silent if it is handed a pack it
  cannot read.

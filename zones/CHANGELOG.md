# Changelog

Notable changes to ZoneLore and its sound packs. Both are versioned together:
see [Compatibility](#compatibility) below.

## 0.3.0 — 2026-08-09

**The vanilla rewrite, and a new narrator**

- The lore was rewritten across the whole corpus to describe the world as a
  1.12 character finds it: later-expansion world state, quest outcomes told as
  settled history, and game-mechanical phrasing are gone, after several full
  review passes over every line.
- Every line re-recorded with a new narrator voice.
- Many pronunciations improved, applied through the shared pronunciation
  dictionary.
- The packs now carry only places the Classic Era client can actually report;
  clips for later-era areas are gone, and with them roughly a third of the
  download.
- The standard pack (ZoneLore Audio 64) is now VBR — noticeably smaller at the
  same spoken quality.

Addon and packs both move to 0.3.0; either works with any 0.x of the other.

## 0.2.3 — 2026-08-04

**Narration for characters who already explored**

- Autoplay rides the game's own "Discovered Durotar" message, which fires once per
  character and never again. On a character who explored Azeroth before installing
  ZoneLore, all of those fired long ago, so the addon had nothing to say — the
  people most likely to want the lore heard the least of it.
- A new setting under Narration, **Also narrate areas you explored before
  installing**, has ZoneLore keep its own record instead and narrate when you
  enter an area rather than when the game announces it. Still one clip per area
  per character; it is off by default, and on a fresh character it changes nothing.
- `/zl forget` now clears that record along with the login greeting, so a
  character can hear the whole thing again.

Sound packs are unchanged — any 0.x pack works with this release.

## 0.2.2 — 2026-08-04

**Read what you are hearing**

- A **Read** button on the playback controls, opening the lore window on whatever
  is being narrated. Narration follows you out of the zone it started in, so the
  words behind a voice you want to reread were often nowhere on screen; finding
  them meant hunting the entry down by name.
- A setting decides whether it stops the narration as well — unticked, the voice
  keeps going and you read along; ticked, the button becomes **Read instead** and
  clicking it leaves you with the text alone. Find it under Narration.
- The controls are now two rows of two rather than one row of three, to fit the
  new button without becoming too wide to sit under the minimap.

Sound packs are unchanged — any 0.x pack works with this release.

## 0.2.1 — 2026-08-02

**Reporting a bad line is now a button press**

- A **Report** button on the map panel, the lore window and the playback
  controls. The client cannot open a browser or send anything anywhere, so it
  offers an address to copy: `lore.rusty.one/r/{zone}/{area}`, a page carrying
  that line's text, its narration and a form. Reporting a bad reading no longer
  means finding the line again among 1353 of them — and while a line is playing,
  the controls carry the button, so you never have to find it at all.
- Options gains a **Report a problem** link, for everything that belongs to no
  particular line: the addon erroring, the voice being wrong throughout.
- The options panel scrolls. It had grown more rows than fit the settings window,
  and the settings canvas neither scrolls nor clips what overflows it, so the last
  few sections were drawing over the game world instead of being reachable.

Both the lore text and the voice are beta, and which entries get rewritten first
follows what comes in. Sound packs are unchanged — 0.2.0 packs work with this
release, as any 0.x pack does.

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

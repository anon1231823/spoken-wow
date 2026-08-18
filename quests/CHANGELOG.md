# Changelog

The notes `scripts/release.sh` sends to CurseForge, one section per released version.

The player and the sound pack are versioned independently — the pack moves when the audio is
rebuilt, the player when its Lua changes — so a section belongs to whichever of the two
carries that version. The heading says which.

## 1.1.0 — sound pack

The pack is now Ogg Vorbis instead of MP3: **564 MB, down from 1.5 GB**, for the same 11,189
lines. Vorbis is worth 1.3–1.5× over MP3 at these bitrates, and the clips are resampled to
22.05 kHz, which speech survives.

Nothing else changed — same lines, same voices, same lookup tables. Install it over the old
pack; the player finds it the same way.

## 1.0.1 — player

Nests the pack under the player in the AddOns list, and targets Blizzard's clients only: one
zip carrying a `.toc` per flavor, which the client picks between.

The 1.12, 2.4.3 and 3.3.5 private-server clients are no longer supported. They predate flavor
suffixes and each needed its own zip and its own vendored Ace3.

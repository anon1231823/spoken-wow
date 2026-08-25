# Changelog

The notes `scripts/release.sh` sends to CurseForge, one section per released version.

The player and the sound pack are versioned independently — the pack moves when the audio is
rebuilt, the player when its Lua changes — so a section belongs to whichever of the two
carries that version. The heading says which.

## 1.2.1 — player

**Turning a quest in no longer replays the quest's opening text.** Anyone running an addon that
replaces Blizzard's quest window — DialogueUI is the common one — heard the accept line again at
every hand-in, and never heard the completion line at all.

- Such an addon detaches Blizzard's quest frame from its events and draws its own window, so
  none of the panels the player was reading are ever shown. Every interaction then looked like a
  quest being offered. The player now falls back to the quest event the client actually fired,
  which says whether this is an offer, a progress check or a hand-in.
- A quest ID the client keeps reporting after a dialog closes no longer replays anything either.

No sound pack change: install the same ones.

## 1.2.0 — player

**The 1.12, 2.4.3 and 3.3.5 private-server clients are supported again.** Each has a zip of its
own on the [GitHub releases page](https://github.com/rusty-key/wow-voiceover/releases), carrying
the one `.toc` that client reads and the Ace3 build it needs. Blizzard's clients keep the single
zip they already had.

- Quest voiceovers now fire on those clients. They dispatch from the quest events directly,
  where the frame-polling reader current Classic needs cannot work.
- The Report button opens its copy box on them too, and its address is selectable.
- "Test Audio" plays through the same path the queue does, so on 2.4.3 and 3.3.5 it uses the
  music channel and can be stopped, as a real voiceover can.
- `/vo diagnostics` reports the addon's actual version instead of a stale one.

The sound packs are unchanged: install the same ones, and the player loads them even where the
client calls them out of date.

## 1.2.1 — sound packs

- The packs show their own artwork in the AddOns list instead of the client's red question
  mark. No audio changed; this is 1.2.0 with an icon.

## 1.2.0 — sound packs

**The pack is now five packs, and you only need two of them.**

- Install the pack for your side and the shared one, and you get every quest line your
  character can reach: about 300 MB instead of 600. Gossip — the ambient chatter NPCs say when
  you talk to them without a quest — is a third, optional pack of 144 MB.
- Anyone who would rather have one install can still take **All**, which now installs the four
  packs for you rather than being a fifth copy of the same audio.
- Nothing was re-recorded. The audio in the split packs is byte-for-byte what 1.1.0 shipped,
  and the four split packs together hold exactly what the complete pack holds — 11,189 clips,
  no overlap, nothing missing.
- Which side a quest belongs to comes from the questgiver: an NPC hostile to the Horde and not
  to the Alliance hands out Alliance quests. Neutral hubs like Booty Bay and Gadgetzan land in
  the shared pack, so their quests play for both sides.
- **The folder names changed.** Updating through an addon manager handles it: the old
  `VoiceOverReduxAudio` folder becomes the small "All" addon, and the packs arrive beside it.
  If you installed by hand, delete the old folder after installing the new packs, or it keeps
  serving the audio it already has.

## 1.1.1 — player

- Shows its own artwork in the AddOns list instead of the client's red question mark. Nothing
  else changed.

## 1.1.0 — player

- Knows about all five sound packs, and offers them only to a player who has none installed
  rather than nagging about the four they deliberately skipped.

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

# Changelog

The notes `scripts/release.sh` sends to CurseForge, one section per released version.

The player and the sound pack are versioned independently — the pack moves when the audio is
rebuilt, the player when its Lua changes — so a section belongs to whichever of the two
carries that version. The heading says which.

## 2.0.1 — player

- **A first login no longer warns about an addon you never installed.** This release carries a
  placeholder folder under the old `VoiceOverRedux` name, so that your settings from before the
  rename keep loading until they have been migrated — and the addon was reading its own
  placeholder as a second, competing voiceover player. A fresh install opened with a dialog
  naming it, and with the client's own "blocked from an action only available to the Blizzard
  UI" dialog behind that, raised by the attempt to switch the folder off. An older player is
  reported and switched off only when it is really loaded and reading quests.
- An older player you had already switched off yourself is no longer described as enabled.

## 2.0.0 — player

Renamed to **Spoken Quests**, and the player extracted into the **Spoken Player** addon that
every Spoken addon speaks through. Addon managers install it automatically; the 1.12, 2.4.3
and 3.3.5 zips carry it inside.

- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **The commands are `/spokenquests` and `/spq`**, matching `/spoken` and `/sp` on the player
  and `/spokenzones` and `/spz` on Spoken Zones. `/vo` and `/voread` are retired — a macro that
  used one has to be edited, and `/voread` is `/spqread` now.
- The sound packs are **Spoken Quests Audio** now, and their folders moved with them:
  `SpokenQuestsAudioAlliance` and friends, where they were `VoiceOverReduxHQAudio*`. Your
  addon manager replaces the old folders; a hand-installed pack has to be deleted by hand,
  or you keep two copies of the same audio.
- Settings migrate on first login from the old VoiceOverRedux folder, which this release
  replaces with a tombstone that can be deleted afterwards.
- One queue with ZoneLore: quest lines and zone narration wait their turn behind each other,
  and nothing interrupts. Gossip yields to a queued quest line in both directions.
- The player frame, minimap button, sound channel and pause are Spoken Player's settings now.
- The settings are sections on one panel rather than a category per branch of an options
  tree. The sound packs you have, the ones you do not, and your profile are all on it,
  rather than behind a button that opened a second window. Every `/spq` command is
  unchanged, and the old window is still there for the clients with no settings panel.
- Choices are dropdowns again rather than buttons that cycled through the options.
- Report is an icon in the player's top right corner rather than a button beside the
  line. Spoken Player's settings can hide it.
- The addon calls itself Spoken Quests everywhere it speaks: chat, dialogs, the minimap
  menu, the self-test and the diagnostics. The original AI VoiceOver is still credited
  where its recording is used.
- Every sound setting is on Spoken Player's panel now: one sound channel for whatever is
  speaking, instead of one per addon, and silencing the game's own NPC dialogue while a
  line is read. Both carry over from your old settings.
- If Spoken Player is installed but switched off, a dialog offers to enable it and
  reload, rather than the addon quietly reading nothing.
- The sound packs are renamed **Spoken Quests Audio: X**, and the HQ family **Spoken Quests
  HQ Audio: X**, in the addon list and on CurseForge. Only the titles change: the folders
  keep their names, so nothing is re-downloaded and every installed pack keeps working.
- Packs are found by `X-SpokenQuests-DataModule-*` as well as the `X-VoiceOver-DataModule-*`
  key every published pack carries. A pack built from now on declares both, so one pack
  serves this release, 1.3.0, and upstream AI VoiceOver alike.

## 1.3.0 — player

**"OG Thrall".** A new option under Audio plays AI VoiceOver's original recording of Thrall's
"All members of the Horde are equal in my eyes" speech in place of this project's own. The
recording ships inside the player, so it plays whichever sound packs are installed — including
none at all. The option is off by default.

No sound pack change: install the same ones.

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

## 2.0.0 — sound packs

**The dwarves were re-recorded.** Every dwarf line is regenerated with a reworked accent —
the old one drifted between takes and landed somewhere that was not Scottish and not
anything else either.

- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **The packs are renamed and so are their folders**: Spoken Quests Audio: Alliance, Horde,
  Shared Quests and Gossip, installing as `SpokenQuestsAudio*`. Your addon manager replaces
  the old `VoiceOverReduxHQAudio*` folders. If you installed by hand, delete the old ones —
  otherwise you keep two copies of several hundred megabytes each, and the player sees both.
- **One pack format.** The downsampled 22.05 kHz packs are retired; these are the
  full-bandwidth ones, ~300 MB a pack. The five retired projects stay installable and get no
  further updates.
- Every pack carries the same version as Spoken Quests from here on.

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

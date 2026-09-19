---
project: 1655859
wago: aN0XPlNj
slug: spoken-quests
name: Spoken Quests
summary: Quest and gossip dialogue, voiced. Needs a Spoken Quests Audio pack. Formerly VoiceOver Redux.
categories:
  - Audio & Video
  - Roleplay
  - Quests & Leveling
license: MIT
---

**Formerly VoiceOver Redux.** A rework of the original VoiceOver addon, which makes NPCs speak their quest text — now one of the Spoken addons, sharing the [Spoken Player](https://www.curseforge.com/wow/addons/spoken-player) with Spoken Zones.

Main changes:

- voices are matched per NPC flavor, instead of just race and gender, so a dwarf warrior and a dwarf official don't sound alike
- object quests are also voiced now, using a narrator voice
- stage directions (`<Advisor Belgrum opens the note.>`) are read by the narrator
- proper voicing of sounds — `<hic>` produces the sound of a hiccup, not the word
- tons of pronunciation fixes
- more natural-sounding performance

**This addon holds no audio, and plays through Spoken.** Install a sound pack alongside it; your addon manager installs the Spoken player automatically. Neither does anything alone.

## Upgrading from VoiceOver Redux

Nothing to do. Your settings carry over on the first login, and the old `VoiceOverRedux` folder is replaced by an empty placeholder that keeps them loading until then — it shows greyed in the AddOns list and can be deleted afterwards. The sound packs are unchanged and keep working. The player window, minimap button and sound channel are now Spoken's settings: Game Menu → Options → AddOns → Spoken.

## Pick a sound pack

| Pack | Holds |
| --- | --- |
| [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all) | installs the four below |
| [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) | Alliance-only quests |
| [Horde](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde) | Horde-only quests |
| [Shared](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared) | quests both factions can take |
| [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) | NPC gossip chatter |

An Alliance player wants Alliance + Shared, a Horde player Horde + Shared, and Gossip on top if they want NPC chatter. Anyone who would rather not choose can take All, which holds no audio itself and simply pulls the four packs in as dependencies.

The player finds whatever packs are installed and plays from all of them, so adding Gossip later, or switching from the split packs to All, needs nothing but the install.

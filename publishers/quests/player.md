---
curseforge: 1655859
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

<!-- only:wago -->
The packs are hundreds of megabytes each, which is more than Wago's uploader takes, so they are downloaded and unzipped into `Interface/AddOns` by hand:

<!-- /only -->
| Pack | Holds |
| --- | --- |
<!-- only:curseforge -->
| [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all) | installs the four below |
<!-- /only -->
| [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) | Alliance-only quests |
| [Horde](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde) | Horde-only quests |
| [Shared](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared) | quests both factions can take |
| [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) | NPC gossip chatter |

An Alliance player wants Alliance + Shared, a Horde player Horde + Shared, and Gossip on top if they want NPC chatter.<!-- only:curseforge --> Anyone who would rather not choose can take All, which holds no audio itself and simply pulls the four packs in as dependencies.<!-- /only -->

The player finds whatever packs are installed and plays from all of them, so adding Gossip later needs nothing but the install.

## When there is no voice

The corpus is built from a 1.12 world database, so it has nothing for a quest written after vanilla, for languages that database does not carry, or for a line an NPC says that nobody has recorded. There the quest window and the gossip window show a **Contribute** button in their top right, under the close button, and the quest log offers the same where a quest's Play would be. Press it and it hands you a link carrying the text your client is showing, along with what it can see of who is speaking -- the model, the sex, the creature type -- which is how a new NPC gets the right voice. Copy it, open it in your browser, and press Send. Your character's name, class and race are swapped back to placeholders before anything leaves the game, so a line can be voiced for everyone. Rather not see the button? **Hide the Contribute buttons** in the Spoken Player settings turns it off.

The first time you press Contribute, you can also choose to **gather as you play**: every quest and NPC line Spoken has no voice for is kept quietly, and you send them all at once by uploading `SavedVariables/SpokenContributions.lua` at spoken.rusty.one/contribute. `/spoken share` shows the steps again, and **Gather missing lines in the background** in the Spoken Player settings turns it off.

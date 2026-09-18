**Install this and get the lot.** It holds no audio itself — it is a few kilobytes that pulls in all four sound packs as dependencies, so your addon manager fetches them for you.

You still need the player: [Spoken Quests](https://www.curseforge.com/wow/addons/spoken-quests). That addon speaks the lines, the packs are the lines, and neither does anything alone.

## The packs

| Pack | Holds | |
| --- | --- | --- |
| **All** | installs the four below | **this page** |
| [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) | Alliance-only quests | |
| [Horde](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde) | Horde-only quests | |
| [Shared Quests](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared) | quests both factions can take | |
| [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) | NPC gossip chatter | |

Most players want less than this. An Alliance character only ever hears Alliance + Shared Quests, a Horde character Horde + Shared Quests, and Gossip is optional chatter on top — so picking two packs saves a large download of dialogue your character can never reach.

**Downloading the zip by hand gets you the stub and nothing else.** Dependencies are something the CurseForge app and WowUp resolve; a manual download cannot. Install the four packs directly in that case.

## Why the audio is split at all

A quest belongs to a side when its questgiver does: an NPC hostile to the Horde and friendly to the Alliance hands out Alliance quests. Givers who talk to both sides — the goblins in Booty Bay and Gadgetzan, and every other neutral hub — land in Shared Quests, so their lines play for everyone.

## What this is

A rework of the original VoiceOver addon, which makes NPCs speak their quest text. Main changes:

- voices are matched per NPC flavor, instead of just race and gender, so a dwarf warrior and a dwarf official don't sound alike
- object quests are also voiced now, using a narrator voice
- stage directions (`<Advisor Belgrum opens the note.>`) are read by the narrator
- proper voicing of sounds — `<hic>` produces the sound of a hiccup, not the word
- tons of pronunciation fixes
- more natural-sounding performance

The audio is Ogg Vorbis rather than MP3 as of 1.2.0, which is most of why the packs are a fraction of the size they used to be for the same lines. Nothing was re-recorded.

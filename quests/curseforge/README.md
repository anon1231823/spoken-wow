# CurseForge project pages

The description of each project, as markdown, one file per project. CurseForge's editor has a
Markdown mode — paste the file into it.

| File | Project | Slug |
| --- | --- | --- |
| `player.md` | VoiceOver Redux | `voiceover-redux` |
| `audio-all.md` | VoiceOver Redux Audio (All) | `voiceover-redux-audio` |
| `audio-alliance.md` | VoiceOver Redux Audio (Alliance) | `voiceover-redux-audio-alliance` |
| `audio-horde.md` | VoiceOver Redux Audio (Horde) | `voiceover-redux-audio-horde` |
| `audio-shared.md` | VoiceOver Redux Audio (Shared) | `voiceover-redux-audio-shared` |
| `audio-gossip.md` | VoiceOver Redux Audio (Gossip) | `voiceover-redux-audio-gossip` |

**These are pasted by hand and the site is the live copy.** There is no API for descriptions —
`scripts/release.sh` uploads files and nothing else, deliberately, because a script that
rewrote project pages each release could quietly undo an edit made in the web UI. So these
files are the source to edit and re-paste, not a mirror anything checks.

The summaries (the one-line preview, separate from the description) are:

- **All** — Every quest and gossip line, voiced. The whole pack in one install. Needs the VoiceOver Redux player.
- **Alliance** — Alliance-only quest dialogue, voiced. Pair it with the Shared pack. Needs the VoiceOver Redux player.
- **Horde** — Horde-only quest dialogue, voiced. Pair it with the Shared pack. Needs the VoiceOver Redux player.
- **Shared** — Quest dialogue both factions can hear, voiced. Install alongside the Alliance or Horde pack. Needs the VoiceOver Redux player.
- **Gossip** — NPC gossip chatter, voiced. Optional extra for any of the quest packs. Needs the VoiceOver Redux player.

Sizes quoted in the descriptions are the 1.2.0 zips. They are worth re-checking when a pack is
rebuilt at a different encode; nothing enforces them.

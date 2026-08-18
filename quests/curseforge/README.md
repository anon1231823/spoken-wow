# CurseForge project pages

The description of each project, as markdown, one file per project. CurseForge's editor has a
Markdown mode — paste the file into it.

| File | Project | id | Slug |
| --- | --- | --- | --- |
| `player.md` | VoiceOver Redux | 1655859 | `voiceover-redux` |
| `audio-all.md` | VoiceOver Redux Audio: All | 1655867 | `voiceover-redux-audio` |
| `audio-alliance.md` | VoiceOver Redux Audio: Alliance | 1658236 | `voiceover-redux-audio-alliance` |
| `audio-horde.md` | VoiceOver Redux Audio: Horde | 1658237 | `voiceover-redux-audio-horde` |
| `audio-shared.md` | VoiceOver Redux Audio: Shared Quests | 1658239 | `voiceover-redux-audio-shared-quests` |
| `audio-gossip.md` | VoiceOver Redux Audio: Gossip | 1658235 | `voiceover-redux-audio-gossip` |

`audio-all` is the odd one: that project ships a **meta addon** rather than audio, because the
complete pack is too big to upload. It is a few kilobytes declaring the other four as required
dependencies, which `scripts/release.sh` sends as part of the upload metadata - relations are
per file, so they need no web-UI step and cannot drift from the file that shipped.

The slugs are what the pages and the addon link to, so they are read off the live projects
rather than guessed - Shared Quests is not the slug its name suggests, and Alliance was
something else again before it was renamed. `scripts/release.sh` carries the same ids, and
`VoiceOverRedux/DataModules.lua` the same URLs, so a slug that changes has to change in all
three. The project names are the addons' `## Title` too - `tts_cli/factions.py:PACK_TITLES` -
so a player sees the same name in the AddOns list as on the site.

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

**No sizes and no line counts in the text.** Both move every time a pack is rebuilt or a line
re-recorded, and a number in prose nothing checks is a number that goes stale on the site while
looking authoritative. CurseForge shows the file size on the Files tab anyway.

Every page carries the same table of the five packs, with the row for that page marked and the
other four linked.

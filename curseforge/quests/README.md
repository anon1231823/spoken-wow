# CurseForge project pages

The description of each project, as markdown, one file per project. CurseForge's editor has a
Markdown mode — paste the file into it.

| File | Project | id | Slug |
| --- | --- | --- | --- |
| `../spoken/spoken.md` | Spoken Player | *create, then write it into `SPOKEN_PROJECT_ID`* | `spoken-player` |
| `player.md` | Spoken Quests (was VoiceOver Redux) | 1655859 | `voiceover-redux` |
| `audio-all.md` | Spoken Quests Audio: All (was VoiceOver Redux Audio: All) | 1655867 | `voiceover-redux-audio` |
| `audio-alliance.md` | Spoken Quests Audio: Alliance (was VoiceOver Redux Audio: Alliance) | 1658236 | `voiceover-redux-audio-alliance` |
| `audio-horde.md` | Spoken Quests Audio: Horde (was VoiceOver Redux Audio: Horde) | 1658237 | `voiceover-redux-audio-horde` |
| `audio-shared.md` | Spoken Quests Audio: Shared Quests (was VoiceOver Redux Audio: Shared Quests) | 1658239 | `voiceover-redux-audio-shared-quests` |
| `audio-gossip.md` | Spoken Quests Audio: Gossip (was VoiceOver Redux Audio: Gossip) | 1658235 | `voiceover-redux-audio-gossip` |

**Renames keep the id, the download count and the file history**; only the name changes, and
the old slug keeps redirecting if the slug is changed too. So the rename to Spoken is done by
renaming the existing projects in the web UI, never by creating replacements. The slugs above
are still the pre-rename ones and stay valid either way; change them here, in `release.sh` and
in `DataModules.lua` only if the slugs are changed on the site.

**Spoken is the one new project.** It must exist *and be approved* before any upload may name
it as a required dependency -- the same errorCode 1018 gate as below -- so create it and upload
its placeholder first, on day one, and write its id into `SPOKEN_PROJECT_ID` (or into
`target_project()` in `scripts/quests/release.sh`) once it is approved. Every Spoken addon then
declares it in `relations`, which is what makes addon managers install it.

`audio-all` is the odd one: that project ships a **meta addon** rather than audio, because the
complete pack is too big to upload. It is a few kilobytes declaring the other four as required
dependencies, which `scripts/release.sh` sends as part of the upload metadata - relations are
per file, so they need no web-UI step and cannot drift from the file that shipped.

**A dependency has to be an approved project**, which is a one-time gate rather than a
per-release one. A newly created project sits at status "New" until moderation clears it, and
until then an upload naming it in `relations` is rejected with errorCode 1018 ("does not exist,
is not accessible"). Once approved it stays approved, and every later `audio-all` upload
resolves immediately - file moderation is separate and does not gate relations, which is why
the four packs uploaded fine while their own projects were still pending.

`release.sh` uploads `audio-all` last for the same reason: its dependencies are resolved at
upload time, so it goes after the things it depends on.

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

- **All** — Every quest and gossip line, voiced. The whole pack in one install. Needs Spoken Quests.
- **Alliance** — Alliance-only quest dialogue, voiced. Pair it with the Shared pack. Needs Spoken Quests.
- **Horde** — Horde-only quest dialogue, voiced. Pair it with the Shared pack. Needs Spoken Quests.
- **Shared** — Quest dialogue both factions can hear, voiced. Install alongside the Alliance or Horde pack. Needs Spoken Quests.
- **Gossip** — NPC gossip chatter, voiced. Optional extra for any of the quest packs. Needs Spoken Quests.

**No sizes and no line counts in the text.** Both move every time a pack is rebuilt or a line
re-recorded, and a number in prose nothing checks is a number that goes stale on the site while
looking authoritative. CurseForge shows the file size on the Files tab anyway.

Every page carries the same table of the five packs, with the row for that page marked and the
other four linked.

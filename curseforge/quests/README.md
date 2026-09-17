# CurseForge project pages

The description of each project, as markdown, one file per project. CurseForge's editor has a
Markdown mode — paste the file into it.

| File | Project | id | Slug |
| --- | --- | --- | --- |
| `../spoken/spoken.md` | Spoken Player | 1700375 | `spoken-player` |
| `player.md` | Spoken Quests (was VoiceOver Redux) | 1655859 | `spoken-quests` |
| `audio-all.md` | Spoken Quests Audio: All | 1660196 | `spoken-quests-audio` |
| `audio-alliance.md` | Spoken Quests Audio: Alliance | 1660197 | `spoken-quests-audio-alliance` |
| `audio-horde.md` | Spoken Quests Audio: Horde | 1660198 | `spoken-quests-audio-horde` |
| `audio-shared.md` | Spoken Quests Audio: Shared Quests | 1660199 | `spoken-quests-audio-shared-quests` |
| `audio-gossip.md` | Spoken Quests Audio: Gossip | 1660202 | `spoken-quests-audio-gossip` |

**Five more projects exist and are retired.** 1655867, 1658236, 1658237, 1658239 and 1658235 held
the downsampled packs, back when the audio shipped at two qualities. They stay published so that
an existing install keeps working, and nothing uploads to them again: they have no id in
`scripts/quests/release.sh`, no description file here, and no row above. The ids are written down
only so that the next person to find them knows they are retired rather than missing.

**Renames keep the id, the download count and the file history**; only the name changes, and the
old slug keeps redirecting once the slug is changed too. So the rename to Spoken was done by
renaming the existing projects in the web UI, never by creating replacements - which is also why
the ids above are the ones the projects have always had.

**The old names stay searchable on purpose.** CurseForge has no keywords field: search matches the
project name and the summary, so "VoiceOver Redux" is findable only because each summary says
*Formerly VoiceOver Redux*. That clause is the one place an old name belongs. Everywhere else -
prose, headings, comments, new identifiers - it reads as a name the project still uses.

**Spoken Player is the project everything else depends on**, and it had to exist *and be
approved* before any upload could name it: the errorCode 1018 gate below. It was created first
for that reason and its id is in `target_project()` in `scripts/quests/release.sh`. Every Spoken
addon declares it in `relations`, which is what makes addon managers install it.

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
rather than guessed - Shared Quests is not the slug its name suggests. They were all changed
when the projects were renamed; the old ones redirect, but a redirect is not something to
depend on, and CurseForge resolves a `relations` slug at upload time. `scripts/quests/release.sh`
carries the same slugs in `target_dependencies()`, `SpokenQuests/DataModules.lua` the same URLs,
and `.github/workflows/release-addons.yaml` the same links, so a slug that changes has to change
in all four. The project names are the addons' `## Title` too - `tts_cli/factions.py:pack_title` -
so a player sees the same name in the AddOns list as on the site.

**The folder names did not change with them.** The packs ship as `VoiceOverReduxHQAudio*` and the
zones pack as `ZoneLoreAudio`, because a renamed folder is a re-download of every clip in it, and
because the player finds packs by folder name. Old name on disk, current name everywhere a player
reads one.

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

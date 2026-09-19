# Project pages

The description of each project, as markdown, one file per project. **Two stores now**:
every project exists on CurseForge and on Wago Addons under the same slug, and this
directory is the source for both pages. It keeps the name `curseforge/` because the CurseForge
ids, the dependency slugs and the numbering are all still CurseForge's; renaming it would
touch the Makefiles, three release scripts and every path in this file to say nothing new.

The frontmatter is everything either submission form asks for besides the body; the body is the
description. Both editors have a Markdown mode — paste `dist/descriptions/<slug>.md` into
CurseForge and `dist/descriptions-wago/<slug>.md` into Wago.

`scripts/descriptions.mjs` reads every directory under `curseforge/`, writes the paste-ready
bodies into `dist/descriptions/` and, with their cross-links pointed at Wago, into
`dist/descriptions-wago/`, regenerates any README a page names in `addonReadme`, and
tracks which pages have been pasted:

```
make descriptions              # regenerate
make descriptions-check        # fail if a generated README has drifted (make lint runs this)
make descriptions-published    # record the current pages as pasted, AFTER pasting them
```

Each directory keeps its own `published.json`, and a release prints the pages in its own group
that have moved on since they were last pasted.

ONE BODY, TWO SETS OF LINKS. A page links to its sibling projects, and a link is only right on
the store it is read on: a player on the Wago page for Spoken Zones should be offered the Wago
page for its sound pack, not sent somewhere their addon manager cannot install from. The
slugs are identical on both stores, so the Wago copy is the same text with one substitution --
which is why there is one file per project here and not two.

| File | Project | CurseForge id | Wago id | Slug |
| --- | --- | --- | --- | --- |
| `spoken/spoken.md` | Spoken Player | 1700375 | QN53yXKB | `spoken-player` |
| `quests/player.md` | Spoken Quests (was VoiceOver Redux) | 1655859 | aN0XPlNj | `spoken-quests` |
| `quests/audio-all.md` | Spoken Quests Audio: All | 1660196 | ANzkpD64 | `spoken-quests-audio-all` |
| `quests/audio-alliance.md` | Spoken Quests Audio: Alliance | 1660197 | 5NR8mJK3 | `spoken-quests-audio-alliance` |
| `quests/audio-horde.md` | Spoken Quests Audio: Horde | 1660198 | vNAg3OKo | `spoken-quests-audio-horde` |
| `quests/audio-shared.md` | Spoken Quests Audio: Shared Quests | 1660199 | QNlz3YKe | `spoken-quests-audio-shared` |
| `quests/audio-gossip.md` | Spoken Quests Audio: Gossip | 1660202 | XKqA45Ky | `spoken-quests-audio-gossip` |
| `zones/spoken-zones.md` | Spoken Zones (was ZoneLore) | 1636521 | mNw7b5No | `spoken-zones` |
| `zones/spoken-zones-audio.md` | Spoken Zones Audio | 1636532 | b6mvD9KP | `spoken-zones-audio` |
| `books/spoken-books.md` | Spoken Books | 1701514 | qGYZnRNg | `spoken-books` |
| `books/spoken-books-audio.md` | Spoken Books Audio | 1701520 | qGZOrvNd | `spoken-books-audio` |

The slugs follow the projects' names, `-all` included: the meta addon is the "All" pack as far
as a player is concerned, so it is the one project whose slug names a pack that holds no audio.

**Six more projects exist and are retired.** 1655867, 1658236, 1658237, 1658239 and 1658235 held
the second set of quest packs, back when the audio shipped at two qualities, and 1636548 the
64 kbps zones pack. They stay published so that
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
rather than guessed. They were all changed when the projects were renamed; the old ones redirect, but a redirect is not something to
depend on, and CurseForge resolves a `relations` slug at upload time. `scripts/quests/release.sh`
carries the same slugs in `target_dependencies()`, `SpokenQuests/DataModules.lua` the same URLs,
and `.github/workflows/release-addons.yaml` the same links, so a slug that changes has to change
in all four. The project names are the addons' `## Title` too - `tts_cli/factions.py:pack_title` -
so a player sees the same name in the AddOns list as on the site.

**The folder names moved with them.** The packs ship as `SpokenQuestsAudio*` and the zones pack as
`SpokenZonesAudio`, where they were `VoiceOverReduxHQAudio*` and `ZoneLoreAudio`. A renamed folder
is a re-download of every clip in it, which the release doing the renaming costs anyway; what it
is not is a broken path, because nothing stores one built from a folder name.

**The sound packs are CurseForge-only, and not by choice.** Wago's version endpoint sits
behind Cloudflare, which refuses a body of a few hundred megabytes with a 413 before Wago
sees it -- the same wall the complete quests pack meets on CurseForge. Every pack is 300-450 MB,
so `scripts/*/release.sh` uploads the addons to both stores and the packs to CurseForge alone,
and the Wago pages say in words where the audio comes from. The Wago ids for the pack projects
are listed above anyway: the projects exist, and the day that endpoint takes a larger file they
are what it uploads to.

**These are pasted by hand and the site is the live copy.** There is no API for descriptions —
`release.sh` uploads files and nothing else, deliberately, because a script that rewrote project
pages each release could quietly undo an edit made in the web UI. So these files are the source
to edit and re-paste, and `published.json` records what you say you pasted rather than anything
read back off the site.

The Wago project id is the `wago:` line in the same frontmatter, eight alphanumeric characters
off the project's entry in <https://addons.wago.io/developers>. `scripts/descriptions.mjs`
checks its shape and the release scripts carry the same ids in `target_wago()`, so an id that
changes has to change in both -- the same arrangement, and the same hazard, as the CurseForge
ids beside them.

The summary — the one-line preview, separate from the description — is the `summary:` line in
each page's frontmatter, where the 255-character limit is checked. It used to be listed here,
which meant two places to edit and one of them silently authoritative.

**No sizes and no line counts in the text.** Both move every time a pack is rebuilt or a line
re-recorded, and a number in prose nothing checks is a number that goes stale on the site while
looking authoritative. CurseForge shows the file size on the Files tab anyway.

Every page carries the same table of the five packs, with the row for that page marked and the
other four linked.

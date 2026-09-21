# Droplet plumbing and packaging for the quests addon and its sound packs.
#
# The audio is the take archive (audio-history/), gitignored and never through CI. Takes
# are cut on the droplet, through the site, so it only ever comes home -- `make pull-history`
# -- to be built into a pack.
#
# The host, the deploy user and the key come from make/droplet.mk, which reads them
# out of the environment. Override for one invocation with DROPLET=deploy@<host>.
include make/droplet.mk


# /srv/spoken, not /srv/voiceover. The cutover has run: the voices and the take archive
# live under /srv/spoken/shared (symlinks into the block volume at
# /mnt/voice/spoken), the `spoken` pm2 app is what serves them, and `voiceover` is stopped.
# Pointing these at the old tree is not an error rsync can report -- it finds a complete,
# consistent store there and syncs happily against a site nobody is using, which is how a
# fortnight of regenerated takes went unnoticed.
REMOTE_VOICES := $(REMOTE_ROOT)/shared/voices/
# Quests' own archive under the shared audio-history -- the directory
# SPOKEN_QUESTS_AUDIO_HISTORY names in deploy/web/ecosystem.config.js. The root holds all
# three sections; syncing against it would mix them.
REMOTE_HISTORY := $(REMOTE_ROOT)/shared/audio-history/quests/
REMOTE_PM2   := pm2

# Passed straight through to scripts/package-audio.sh, which documents each one. Empty
# means the script's own default, so `make pack` needs no arguments to do the usual thing.
VERSION ?=
ENCODE  ?=
JOBS    ?=

# The pipeline's own interpreter, and its own directory: cli-main.py and the venv are under
# pipelines/quests/, while every path in this file is relative to the repo root because the
# dispatcher runs it from there. Resolving .venv/bin/python against the root found nothing,
# fell back to the system python3, and every target calling the CLI died on a
# cli-main.py that was never there -- the one thing the merge moved and this did not follow.
QUESTS_DIR   := pipelines/quests
PYTHON       ?= $(shell [ -x $(QUESTS_DIR)/.venv/bin/python ] && echo $(abspath $(QUESTS_DIR)/.venv/bin/python) || command -v python3)

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)


# Fail with an explanation rather than an rsync usage dump or a silent no-op reload.
define preflight
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. macOS ships openrsync, which lacks --info."; \
	                        echo "Install one:  brew install rsync"; exit 1; }
	@case "$(DROPLET)" in root@*) \
	  echo "DROPLET is $(DROPLET). Use deploy@ instead: pm2 daemons are per-user, so a"; \
	  echo "reload as root finds no 'voiceover' process and the new audio stays invisible."; \
	  exit 1;; esac
endef

.DEFAULT_GOAL := help
.PHONY: help pull-voices push-voices voices-status \
        pull-history history-status sounds package package-audio \
        package-audio-complete package-meta push-complete icon \
        downloads-status \
        factions release release-audio release-wago release-curse \
        release-dry import-corpus export-corpus export-ignores \
        fold-overrides sync check-synced

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- addon tests ----------------------------------------------------------------------

# The player's quest dispatch, run against a stubbed client. LuaJIT is the interpreter
# because it speaks the 5.1 the game does, including setfenv, which every addon file calls.
# test-player moved to the root Makefile: tests/lua/ is shared by every addon now,
# not just this one.

# --- voice clips ----------------------------------------------------------------------
#
# The clips a voice was cloned from. Small (kilobytes each) but irreplaceable: an ElevenLabs
# voice cannot be exported, so losing these means a voice can never be remade - the exact
# failure that left this project with inherited voices it could not reproduce.
#
# Uploads happen on the droplet through the web UI, so the droplet is usually the newer
# side. Neither target uses --delete for that reason: these are two
# collections being kept in sync by hand, not a mirror with an authoritative side.

pull-voices: require-droplet ## Fetch voice clips from the droplet (non-destructive)
	$(preflight)
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		$(DROPLET):$(REMOTE_VOICES) pipelines/quests/voice/samples/
	@echo "==> pulled into pipelines/quests/voice/samples/"

push-voices: require-droplet ## Upload voice clips to the droplet (non-destructive)
	$(preflight)
	@[ -d pipelines/quests/voice/samples ] || { echo "no pipelines/quests/voice/samples/ to push"; exit 1; }
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		pipelines/quests/voice/samples/ $(DROPLET):$(REMOTE_VOICES)
	@echo "==> pushed"

voices-status: require-droplet ## Compare clip count and size on both sides
	@echo "local:  $$(find pipelines/quests/voice/samples -type f 2>/dev/null | wc -l | tr -d ' ') clips, $$(du -sh pipelines/quests/voice/samples 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_VOICES) -type f 2>/dev/null | wc -l | tr -d " ") clips, $$(du -sh $(REMOTE_VOICES) 2>/dev/null | cut -f1)"'

# --- take archive -------------------------------------------------------------------
#
# Every take of every line, the live one included: the only quests audio there is, and the
# one directory whose loss is permanent, since some of it predates this project's ability to
# reproduce it. Takes are cut on the droplet, through the site, so it only ever comes home,
# and never with --delete.

pull-history: require-droplet ## Fetch the droplet's archived takes (non-destructive)
	$(preflight)
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		$(DROPLET):$(REMOTE_HISTORY) pipelines/quests/audio-history/
	@echo "==> pulled into pipelines/quests/audio-history/. Build a pack's audio with:  make quests-sounds"

history-status: require-droplet ## Compare take count and size on both sides
	@echo "local:  $$(find pipelines/quests/audio-history -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ') takes, $$(du -sh pipelines/quests/audio-history 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_HISTORY) -name "*.mp3" 2>/dev/null | wc -l | tr -d " ") takes, $$(du -sh $(REMOTE_HISTORY) 2>/dev/null | cut -f1)"'

# The folder a pack is built from, pipelines/quests/audio/: not kept, but assembled from the
# live takes and the archive before every build. See scripts/audio/sounds.mjs.
sounds: ## Assemble pipelines/quests/audio from the live takes and the archive
	@$(DB_ENV) node scripts/audio/sounds.mjs quests

# --- packaging ------------------------------------------------------------------------
#
# Two zips built on their own schedules, which is why they are two targets: most changes to
# the player touch no voiceline, and the sound pack is three orders of magnitude larger.
#
# `package` takes its version from `## Version:` in SpokenQuests.toc, so bumping the addon
# and naming the zips stay one edit. It refuses to build from an uncommitted tree, because a
# zip nobody can trace back to a commit is a zip nobody can rebuild - ALLOW_DIRTY=1 to
# override while testing. Four zips come out: one for Blizzard's clients, which pick a .toc by
# flavor suffix, and one apiece for 1.12, 2.4.3 and 3.3.5, which read SpokenQuests.toc and
# nothing else and each need their own vendored Ace3 in it. Only the first goes to CurseForge;
# the GitHub release workflow publishes all four.
#
# `package-audio` builds the store into five packs - Alliance, Horde, the quests both sides
# share, gossip, and one holding everything - and zips each. Ogg Vorbis at the full 44.1 kHz,
# around 300 MB a pack. Its own header explains every choice; VERSION goes into each TOC,
# PACKS=all builds only the complete one, ENCODE=copy skips the transcode to hear the masters
# in game, JOBS=1 makes a failing encode readable.
#
# ONE PACK FORMAT. A second set at half the size shipped alongside these for a while, five
# CurseForge projects of its own, because an addon manager installs a project's newest file and
# one project holding two formats would move a player out of the one they picked. That is over:
# those five projects stay published and are never uploaded to again, and nothing here builds
# them. docs/pack-size.md is where every encode that was considered was measured.

# The AddOns list reads a TGA or BLP, never the PNGs in pipelines/quests/assets/icon/, so the
# icon is converted and committed. Two marks, not one: the player wears the play triangle and
# Spoken Quests the exclamation mark, since they sit next to each other in that list. The five
# sound packs take the Quests mark -- scripts/quests/package-meta.sh and tts_cli/build.py copy
# spoken-quests.tga into every module they build.
# The minimap button wears the same player mark from a tighter crop, as a BLP rather than a
# TGA: a texture a frame loads is BLP on every client this ships to. LibDBIcon draws its own
# round border around it, so the crop drops the shield's octagonal frame -- two frames at 17
# pixels is mud. pipelines/quests/tools/make_minimap_icon.py says why each number is what it is.
icon: ## Rebuild the addons' icon.tga and the minimap BLP from pipelines/quests/assets/icon/*-512.png (needs ffmpeg)
	@python3 pipelines/quests/tools/make_icon.py pipelines/quests/assets/icon/spoken-player-512.png pipelines/quests/assets/icon/spoken-player.tga
	@python3 pipelines/quests/tools/make_icon.py pipelines/quests/assets/icon/spoken-quests-512.png pipelines/quests/assets/icon/spoken-quests.tga
	@cp pipelines/quests/assets/icon/spoken-player.tga addons/SpokenPlayer/icon.tga
	@cp pipelines/quests/assets/icon/spoken-quests.tga addons/SpokenQuests/icon.tga
	@echo "==> copied into addons/SpokenPlayer/ and addons/SpokenQuests/"
	@python3 pipelines/quests/tools/make_minimap_icon.py pipelines/quests/assets/icon/spoken-player-512.png addons/SpokenPlayer/Textures/MinimapButton.blp

package: ## Zip the player addon into dist/: one Blizzard zip, one per legacy client
	@./scripts/quests/package.sh

package-audio: check-synced sounds ## Transcode, build and zip the five sound packs into dist/ (VERSION=1.4.0)
	@VERSION=$(VERSION) ENCODE=$(if $(ENCODE),$(ENCODE),ogg-q0-44k) MODULE=SpokenQuestsAudio \
	  JOBS=$(JOBS) ./scripts/quests/package-audio.sh

# Every line in one folder rather than split five ways, ~1.3 GB. Not a CurseForge release - it
# is over the upload ceiling and always will be - so it is built for people who would rather
# take one download, and it is a folder of its own rather than a fatter copy of a shipping pack,
# so installing it beside them is possible but pointless. The site hosts it: `push-complete`
# below, under the one current name -- see the note there.

package-audio-complete: check-synced sounds ## Build the whole corpus as one folder for the site (~1.3 GB)
	@VERSION=$(VERSION) ENCODE=ogg-q0-44k PACKS=all \
	  MODULE_NAME=SpokenQuestsAudioComplete TITLE="Spoken Quests Audio: Complete" \
	  JOBS=$(JOBS) ./scripts/quests/package-audio.sh

# The "install everything" addon, which installs nothing itself: a few kilobytes declaring the
# four packs as CurseForge dependencies, because the complete pack is too big to upload. Its
# header explains the rest; release.sh sends the dependency list with the file.
#
# NAME is the bare pack-family folder, which the split packs leave free, and which release.sh
# uploads as audio-all.

package-meta: ## Zip the meta addon that pulls in all four packs
	@VERSION=$(VERSION) NAME=SpokenQuestsAudio ./scripts/quests/package-meta.sh

# The complete pack's home, since it is too big for CurseForge: nginx serves
# /srv/spoken/shared/downloads/ straight off disk (see deploy/web/nginx-spoken.conf), and
# this puts a freshly built zip there.
#
# The version comes from the built module rather than a variable, so pushing a pack nobody
# built fails here instead of uploading whatever zip is oldest in dist/. -latest.zip is a
# symlink repointed after the copy: the published URL never changes, and it never points at a
# half-transferred file because rsync writes to a temporary name and renames.
#
# ONE NAME. The pack was published as VoiceOverReduxAudioHQ-latest.zip before the rename, and
# that URL is not kept alive: the descriptions that carried it are being re-pasted with the
# current one, and the pack itself is re-downloaded this release whatever its name.

# What nginx-spoken.conf serves at /downloads/. voiceover.rusty.one is a redirect vhost now,
# so a zip pushed into the old tree would land in a directory nothing answers from.
REMOTE_DOWNLOADS := $(REMOTE_ROOT)/shared/downloads

push-complete: require-droplet ## Upload the built complete pack to the site's downloads directory
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. brew install rsync"; exit 1; }
	@v=$$(sed -n 's/^## Version:[[:space:]]*//p' dist/SpokenQuestsAudioComplete/SpokenQuestsAudioComplete.toc 2>/dev/null | head -1); 	[ -n "$$v" ] || { echo "No complete module built. Run: make package-audio-complete"; exit 1; }; 	zip=dist/SpokenQuestsAudioComplete-$$v.zip; 	[ -f "$$zip" ] || { echo "$$zip is missing. Run: make package-audio-complete"; exit 1; }; 	echo "==> $$zip -> $(DROPLET):$(REMOTE_DOWNLOADS)/"; 	$(RSYNC) -a --human-readable --info=progress2 -e "$(SSH)" "$$zip" $(DROPLET):$(REMOTE_DOWNLOADS)/; 	$(SSH) $(DROPLET) "ln -sfn SpokenQuestsAudioComplete-$$v.zip $(REMOTE_DOWNLOADS)/SpokenQuestsAudioComplete-latest.zip"; 	echo "==> https://spoken.rusty.one/downloads/SpokenQuestsAudioComplete-latest.zip"

downloads-status: require-droplet ## List what the site is offering for download
	@$(SSH) $(DROPLET) 'ls -lh $(REMOTE_DOWNLOADS)/'

# `release` uploads whatever is already in dist/ to CurseForge - it builds nothing, so the
# zip it sends is the one you tested. The player's version comes from its .toc and the pack's
# from the module last built, and each looks its own section up in CHANGELOG.md. Needs
# CURSEFORGE_TOKEN in the repo-root .env. Always worth a release-dry first: it resolves the game versions
# and prints every file and note without sending anything.

# The faction split the packs are cut along. Needs the vmangos world DB up
# (`docker compose up -d mysql`), which is the only thing in this repo that does - the export
# is committed so that building a pack never needs a database. pipelines/quests/tools/export_factions.py
# explains how a quest gets a side.

factions: ## Re-export pipelines/quests/corpus/factions.json from the world DB (needs MySQL)
	@$(PYTHON) pipelines/quests/tools/export_factions.py

release-dry: ## Show what `make release` would upload to CurseForge and Wago
	@./scripts/quests/release.sh --dry-run

release: ## Upload the built zips to CurseForge and Wago (needs both tokens)
	@./scripts/quests/release.sh

# The packs alone, for when the audio was rebuilt and the player was not. The meta addon comes
# last, since CurseForge resolves its dependencies at upload time.

release-audio: ## Upload the four packs and their meta addon
	@./scripts/quests/release.sh audio-alliance audio-horde audio-shared audio-gossip audio-all

# --- the ignore list ------------------------------------------------------------------
#
# Lines this project has decided never to voice: the war-effort tallies, whose $$2113w is a
# counter the game expands against a live server, and Blizzard's own debris. The decision is
# made in the web app and lives in Postgres, where it carries a reason and an author. The
# committed file is the only form the Python CLI and rsync can read - neither has a
# database - so `make quests-export-ignores` writes it from the table.
#
# It used to be pulled from the droplet over ssh, because the droplet's database was the
# only one that had the rows. `make quests-sync` brings them home now, so the export is a
# local read like every other one here, and deploy/web/sql/export_ignores.sql is gone with
# the target that fed it.
#
# One direction only, either way. Editing the file by hand would put it out of step with
# the table the app reads, and the app is what everyone looks at.

# The corpus, which lives in Postgres now.
#
# corpus/corpus.json.gz is still what the Python CLI and the addon build read, and still
# committed -- producing audio and shipping a pack need no database, which is the promise
# requirements.txt makes. What changed is that the file is an EXPORT of quest_line rather
# than something maintained by hand, exactly as zones' manifest.json is an export of the
# take table. The check that proves the table carries everything is that an import followed
# by an export leaves the file byte-identical.

# Run from the pipeline's directory, because the CLI's default paths are relative to it.
QUESTS_CLI = cd $(QUESTS_DIR) && $(abspath $(PYTHON)) cli-main.py

import-corpus: ## corpus/corpus.json.gz -> quest_line (needs DATABASE_URL and psycopg2)
	@$(QUESTS_CLI) import-corpus

export-corpus: check-synced ## quest_line -> corpus/corpus.json.gz (ARGS=--check to compare instead)
	@$(QUESTS_CLI) export-corpus $(ARGS)

export-ignores: ## line_ignore -> corpus/ignored.json, replacing the old ssh export
	@$(QUESTS_CLI) export-ignores $(ARGS)

fold-overrides: ## line_override rows -> edited versions. Once, after import-corpus.
	@$(QUESTS_CLI) fold-overrides

# THE DROPLET IS UPSTREAM FOR EVERYTHING THE APP WRITES.
#
# Corpus edits and takes are made on the site, so the droplet's database is the newer side
# of both. A laptop is upstream for exactly one thing: a fresh vmangos extract, which is
# imported locally and pushed before a build. At build time, then, data only ever flows one
# way -- which is what makes it safe to package from a laptop at all.
#
# Before this, a pack built here could ship words production had already corrected, and
# nothing would have said so. The corpus was a committed file, so "is it current?" meant
# "did you pull recently?", and the answer was somebody's memory.

sync: require-droplet ## Replace the local quests corpus and takes with the droplet's (DESTRUCTIVE)
	@$(DB_ENV) scripts/db/sync-section.sh quests \
	  quest_line quest_line_speaker quest_spawn quest_corpus_meta line_ignore
	@echo "==> rebuild the committed corpus with:  make quests-export-corpus"

# Refuses to let a stale laptop ship a pack, or asks first. scripts/db/check-synced.sh has
# the reasoning; every section's packaging runs the same one.
check-synced: ## Compare the local quests data with the droplet's, and prompt if they differ
	@$(DB_ENV) scripts/db/check-synced.sh quests

# One store at a time, for the case a release half-landed: a zip CurseForge took and Wago
# refused, or the other way round. Re-running `release` would upload the file twice to the
# store that already has it, which each of them shows as a duplicate rather than ignoring.
release-wago: ## Upload the built zips to Wago only (needs WAGO_TOKEN)
	@./scripts/quests/release.sh --store=wago

release-curse: ## Upload the built zips to CurseForge only (needs CURSEFORGE_TOKEN)
	@./scripts/quests/release.sh --store=curseforge

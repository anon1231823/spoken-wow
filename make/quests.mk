# Audio store sync and droplet plumbing for the voiceline explorer.
#
# The audio store (1.1 GB, 9,456 mp3s) is gitignored and never travels through CI - it
# moves between your machine and the droplet with rsync, only when you say so.
#
# Override the target host on the command line or in the environment:
#   make push DROPLET=deploy@203.0.113.10

# Connect as deploy, never root: pm2 daemons are per-user, so `pm2 reload` over an ssh
# session as root talks to root's empty daemon and silently does nothing, leaving the
# freshly pushed audio invisible. An IP rather than a hostname keeps this working if the
# name is ever pointed at a CDN, which would not proxy SSH.
DROPLET      ?= deploy@188.166.37.175
REMOTE_ROOT  := /srv/voiceover
REMOTE_AUDIO := $(REMOTE_ROOT)/shared/audio/
REMOTE_VOICES := $(REMOTE_ROOT)/shared/voices/
REMOTE_HISTORY := $(REMOTE_ROOT)/shared/audio-history/
REMOTE_PM2   := pm2

# The ignore list and the rsync exclusion file derived from it.
#
# pipelines/quests/corpus/ignored.json is committed and exported from the database by `make pull-ignores`;
# .rsync-ignored is regenerated before every transfer and gitignored. Deriving it each time
# rather than committing it means a stale exclusion cannot survive a decision being undone.
# Passed straight through to scripts/package-audio.sh, which documents each one. Empty
# means the script's own default, so `make pack` needs no arguments to do the usual thing.
VERSION ?=
ENCODE  ?=
JOBS    ?=

IGNORED_JSON := pipelines/quests/corpus/ignored.json
IGNORED_LIST := .rsync-ignored
# The pipeline's own interpreter, and its own directory: cli-main.py and the venv are under
# pipelines/quests/, while every path in this file is relative to the repo root because the
# dispatcher runs it from there. Resolving .venv/bin/python against the root found nothing,
# fell back to the system python3, and every push/pull target died in its preflight on a
# cli-main.py that was never there -- the one thing the merge moved and this did not follow.
QUESTS_DIR   := pipelines/quests
PYTHON       ?= $(shell [ -x $(QUESTS_DIR)/.venv/bin/python ] && echo $(abspath $(QUESTS_DIR)/.venv/bin/python) || command -v python3)

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# The key CI authenticates with, so `make ssh-check` tests what CI actually does. Every
# droplet target uses it too: the deploy user authorises this key only, and a bare `ssh`
# would offer whatever ~/.ssh/config names instead and be refused.
DEPLOY_KEY ?= ~/.ssh/id_rusty.one
SSH        := ssh -i $(DEPLOY_KEY) -o IdentitiesOnly=yes

# No -z: mp3 is already compressed, so it is pure CPU for ~0 gain.
# --delete keeps the two stores in exact correspondence, which is what makes the "missing
# audio" badges in the UI trustworthy - see isGap() in apps/web/src/lib/search.ts.
#
# --exclude-from keeps the lines nobody will ever voice out of both directions. It also stops
# --delete removing what it excludes, on either side: an ignored line's audio is left where it
# already is rather than destroyed, because ignoring is a decision about a line and not a
# licence to throw away a take. See tts_cli/ignores.py.
RSYNC_OPTS := -a --delete --partial --human-readable --info=progress2 -e "$(SSH)" \
	--exclude-from=$(IGNORED_LIST)

# Fail with an explanation rather than an rsync usage dump or a silent no-op reload.
define preflight
	@$(PYTHON) $(QUESTS_DIR)/cli-main.py ignored-files --corpus $(QUESTS_DIR)/corpus/corpus.json.gz \
	  --ignored $(IGNORED_JSON) > $(IGNORED_LIST) \
	  || { echo "could not derive $(IGNORED_LIST) from $(IGNORED_JSON)"; exit 1; }
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. macOS ships openrsync, which lacks --info."; \
	                        echo "Install one:  brew install rsync"; exit 1; }
	@case "$(DROPLET)" in root@*) \
	  echo "DROPLET is $(DROPLET). Use deploy@ instead: pm2 daemons are per-user, so a"; \
	  echo "reload as root finds no 'voiceover' process and the new audio stays invisible."; \
	  exit 1;; esac
endef

.DEFAULT_GOAL := help
.PHONY: help push pull push-dry pull-dry audio-status pull-voices push-voices voices-status \
        pull-history push-history history-status pull-ignores package package-audio \
        package-audio-complete package-meta push-complete \
        downloads-status \
        factions release release-audio \
        release-dry deploy-scripts \
        rollback releases \
        ssh-check

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- addon tests ----------------------------------------------------------------------

# The player's quest dispatch, run against a stubbed client. LuaJIT is the interpreter
# because it speaks the 5.1 the game does, including setfenv, which every addon file calls.
# test-player moved to the root Makefile: tests/lua/ is shared by every addon now,
# not just this one.

# --- audio store ----------------------------------------------------------------------

push-dry: ## Preview what `make push` would change on the droplet
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run pipelines/quests/audio/ $(DROPLET):$(REMOTE_AUDIO)

pull-dry: ## Preview what `make pull` would change locally
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(DROPLET):$(REMOTE_AUDIO) pipelines/quests/audio/

# Which local files would overwrite something NEWER on the droplet.
#
# Two dry runs and a set difference, no remote script. `-u` skips files the receiver has a
# newer copy of, so anything in the first listing and not the second is exactly a file the
# droplet has changed since you last pulled - which the web app now does every time someone
# regenerates a line. Before that existed the droplet could only ever be stale; now it is
# usually the newer side, and --delete would take the difference with it.
#
# -i is load-bearing: without it rsync prints bare filenames, `grep '^>f'` matches nothing,
# and the guard passes every time while looking like it ran.
define freshness
	@a=$$(mktemp); b=$$(mktemp); \
	$(RSYNC) $(RSYNC_OPTS) -i --dry-run    pipelines/quests/audio/ $(DROPLET):$(REMOTE_AUDIO) | grep '^>f' | awk '{print $$2}' | sort > $$a; \
	$(RSYNC) $(RSYNC_OPTS) -i -u --dry-run pipelines/quests/audio/ $(DROPLET):$(REMOTE_AUDIO) | grep '^>f' | awk '{print $$2}' | sort > $$b; \
	newer=$$(comm -23 $$a $$b); rm -f $$a $$b; \
	if [ -n "$$newer" ]; then \
	  echo; echo "REFUSING: the droplet has newer audio for these files:"; \
	  echo "$$newer" | sed 's/^/    /' | head -30; \
	  echo "$$newer" | wc -l | xargs printf '    (%s files)\n'; \
	  echo; echo "Those takes were made on the droplet and are not here. Run 'make pull' first,"; \
	  echo "or 'make push FORCE=1' to overwrite them anyway."; \
	  [ "$(FORCE)" = 1 ] || exit 1; \
	  echo "FORCE=1 given, continuing."; \
	fi
endef

push: ## Upload pipelines/quests/audio/ to the droplet (refuses to clobber newer droplet takes)
	$(preflight)
	$(freshness)
	@echo "==> dry run (local -> $(DROPLET))"
	@$(RSYNC) $(RSYNC_OPTS) --dry-run pipelines/quests/audio/ $(DROPLET):$(REMOTE_AUDIO) | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	$(RSYNC) $(RSYNC_OPTS) pipelines/quests/audio/ $(DROPLET):$(REMOTE_AUDIO)
	@# No pm2 reload: storeIndex() re-reads whenever either subfolder's mtime moves, which
	@# a push always changes. It had to reload while the memo was permanent - see the
	@# freshness note in apps/web/src/lib/audio.ts.
	@echo "==> pushed"

pull: ## Download the droplet's audio store into pipelines/quests/audio/ (DESTRUCTIVE: --delete)
	$(preflight)
	@echo "==> dry run ($(DROPLET) -> local)"
	@echo "    --delete will REMOVE local files the droplet does not have."
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(DROPLET):$(REMOTE_AUDIO) pipelines/quests/audio/ | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	$(RSYNC) $(RSYNC_OPTS) $(DROPLET):$(REMOTE_AUDIO) pipelines/quests/audio/
	@echo "==> pulled"

# --- voice clips ----------------------------------------------------------------------
#
# The clips a voice was cloned from. Small (kilobytes each) but irreplaceable: an ElevenLabs
# voice cannot be exported, so losing these means a voice can never be remade - the exact
# failure that left this project with inherited voices it could not reproduce.
#
# Uploads happen on the droplet through the web UI, so unlike the audio store the droplet is
# usually the newer side. Neither target uses --delete for that reason: these are two
# collections being kept in sync by hand, not a mirror with an authoritative side.

pull-voices: ## Fetch voice clips from the droplet (non-destructive)
	$(preflight)
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		$(DROPLET):$(REMOTE_VOICES) pipelines/quests/voice/samples/
	@echo "==> pulled into pipelines/quests/voice/samples/"

push-voices: ## Upload voice clips to the droplet (non-destructive)
	$(preflight)
	@[ -d pipelines/quests/voice/samples ] || { echo "no pipelines/quests/voice/samples/ to push"; exit 1; }
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		pipelines/quests/voice/samples/ $(DROPLET):$(REMOTE_VOICES)
	@echo "==> pushed"

voices-status: ## Compare clip count and size on both sides
	@echo "local:  $$(find pipelines/quests/voice/samples -type f 2>/dev/null | wc -l | tr -d ' ') clips, $$(du -sh pipelines/quests/voice/samples 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_VOICES) -type f 2>/dev/null | wc -l | tr -d " ") clips, $$(du -sh $(REMOTE_VOICES) 2>/dev/null | cut -f1)"'

# --- take history --------------------------------------------------------------------
#
# Previous takes of regenerated lines. Version 0 of each file is the audio that predated this
# project's ability to reproduce it, so this is the one directory whose loss is permanent.
# Small next to the store, and like the voice clips the droplet is usually the newer side -
# so neither target uses --delete.

pull-history: ## Fetch previous takes from the droplet (non-destructive)
	$(preflight)
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		$(DROPLET):$(REMOTE_HISTORY) pipelines/quests/audio-history/
	@echo "==> pulled into pipelines/quests/audio-history/"

push-history: ## Upload previous takes to the droplet (non-destructive)
	$(preflight)
	@[ -d pipelines/quests/audio-history ] || { echo "no pipelines/quests/audio-history/ to push"; exit 1; }
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		pipelines/quests/audio-history/ $(DROPLET):$(REMOTE_HISTORY)
	@echo "==> pushed"

history-status: ## Compare take count and size on both sides
	@echo "local:  $$(find pipelines/quests/audio-history -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ') takes, $$(du -sh pipelines/quests/audio-history 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_HISTORY) -name "*.mp3" 2>/dev/null | wc -l | tr -d " ") takes, $$(du -sh $(REMOTE_HISTORY) 2>/dev/null | cut -f1)"'

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

package: ## Zip the player addon into dist/: one Blizzard zip, one per legacy client
	@./scripts/quests/package.sh

package-audio: ## Transcode, build and zip the five sound packs into dist/ (VERSION=1.4.0)
	@VERSION=$(VERSION) ENCODE=$(if $(ENCODE),$(ENCODE),ogg-q0-44k) MODULE=SpokenQuestsAudio \
	  JOBS=$(JOBS) ./scripts/quests/package-audio.sh

# Every line in one folder rather than split five ways, ~1.3 GB. Not a CurseForge release - it
# is over the upload ceiling and always will be - so it is built for people who would rather
# take one download, and it is a folder of its own rather than a fatter copy of a shipping pack,
# so installing it beside them is possible but pointless. The site hosts it: `push-complete`
# below, under the one current name -- see the note there.

package-audio-complete: ## Build the whole corpus as one folder for the site (~1.3 GB)
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
# /srv/voiceover/shared/downloads/ straight off disk (see deploy/quests/nginx-voiceover.conf), and
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

# Under /srv/spoken, not REMOTE_ROOT: this is the one target here whose output is served
# rather than read by the pipeline. voiceover.rusty.one is a redirect vhost now, so
# /downloads/ is answered from /srv/spoken/shared/downloads (nginx-spoken.conf), and a zip
# pushed into the old tree would be uploaded to a directory nothing serves. The audio store
# above stays where it is until cutover-audio has moved it -- see make/web.mk.
REMOTE_DOWNLOADS := /srv/spoken/shared/downloads

push-complete: ## Upload the built complete pack to the site's downloads directory
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. brew install rsync"; exit 1; }
	@v=$$(sed -n 's/^## Version:[[:space:]]*//p' dist/SpokenQuestsAudioComplete/SpokenQuestsAudioComplete.toc 2>/dev/null | head -1); 	[ -n "$$v" ] || { echo "No complete module built. Run: make package-audio-complete"; exit 1; }; 	zip=dist/SpokenQuestsAudioComplete-$$v.zip; 	[ -f "$$zip" ] || { echo "$$zip is missing. Run: make package-audio-complete"; exit 1; }; 	echo "==> $$zip -> $(DROPLET):$(REMOTE_DOWNLOADS)/"; 	$(RSYNC) -a --human-readable --info=progress2 -e "$(SSH)" "$$zip" $(DROPLET):$(REMOTE_DOWNLOADS)/; 	$(SSH) $(DROPLET) "ln -sfn SpokenQuestsAudioComplete-$$v.zip $(REMOTE_DOWNLOADS)/SpokenQuestsAudioComplete-latest.zip"; 	echo "==> https://spoken.rusty.one/downloads/SpokenQuestsAudioComplete-latest.zip"

downloads-status: ## List what the site is offering for download
	@$(SSH) $(DROPLET) 'ls -lh $(REMOTE_DOWNLOADS)/'

# `release` uploads whatever is already in dist/ to CurseForge - it builds nothing, so the
# zip it sends is the one you tested. The player's version comes from its .toc and the pack's
# from the module last built, and each looks its own section up in CHANGELOG.md. Needs
# CURSEFORGE_TOKEN in .env. Always worth a release-dry first: it resolves the game versions
# and prints every file and note without sending anything.

# The faction split the packs are cut along. Needs the vmangos world DB up
# (`docker compose up -d mysql`), which is the only thing in this repo that does - the export
# is committed so that building a pack never needs a database. pipelines/quests/tools/export_factions.py
# explains how a quest gets a side.

factions: ## Re-export pipelines/quests/corpus/factions.json from the world DB (needs MySQL)
	@$(PYTHON) pipelines/quests/tools/export_factions.py

release-dry: ## Show what `make release` would upload to CurseForge
	@./scripts/quests/release.sh --dry-run

release: ## Upload the built zips to CurseForge (needs CURSEFORGE_TOKEN)
	@./scripts/quests/release.sh

# The packs alone, for when the audio was rebuilt and the player was not. The meta addon comes
# last, since CurseForge resolves its dependencies at upload time.

release-audio: ## Upload the four packs and their meta addon
	@./scripts/quests/release.sh audio-alliance audio-horde audio-shared audio-gossip audio-all

# --- the ignore list ------------------------------------------------------------------
#
# Lines this project has decided never to voice: the war-effort tallies, whose $$2113w is a
# counter the game expands against a live server, and Blizzard's own debris. The decision is
# made in the web app and lives in Postgres, where it carries a reason and an author. This
# brings it back as a committed file, which is the only form the Python CLI and rsync can
# read - neither has a database.
#
# One direction only. Editing the file by hand would put it out of step with the table the
# app reads, and the app is what everyone looks at.

pull-ignores: ## Export the ignore list from the droplet into pipelines/quests/corpus/ignored.json
	@$(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; \
	  psql "$$DATABASE_URL" -At -f -' < deploy/quests/sql/export_ignores.sql > $(IGNORED_JSON).tmp
	@# A truncated or failed export must not replace a good list: an empty file here would
	@# silently un-ignore every line the next time anyone pushed or built.
	@$(PYTHON) -c "import json,sys; json.load(open(sys.argv[1]))['ignored']" $(IGNORED_JSON).tmp \
	  || { rm -f $(IGNORED_JSON).tmp; echo "export was not a list; kept $(IGNORED_JSON)"; exit 1; }
	@mv $(IGNORED_JSON).tmp $(IGNORED_JSON)
	@echo "==> wrote $(IGNORED_JSON). Commit it: the CLI and the rsync targets read the file, not the database."

audio-status: ## Compare file count and size on both sides
	@echo "local:  $$(find audio -name '*.mp3' | wc -l | tr -d ' ') files, $$(du -sh audio | cut -f1)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_AUDIO) -name "*.mp3" | wc -l | tr -d " ") files, $$(du -sh $(REMOTE_AUDIO) | cut -f1)"'

# --- droplet plumbing -----------------------------------------------------------------

# `-F /dev/null` is the point of this target, and IdentitiesOnly alone is not enough: a
# `Host *` block in ~/.ssh/config contributes its IdentityFile entries to every host, so
# a plain `ssh -i deploy_key host` can succeed on a personal key and report a working
# deploy key that CI - which has only this one, and no ssh config - cannot use.
ssh-check: ## Test the CI deploy key against the droplet, as CI authenticates
	@echo "local  $(DEPLOY_KEY): $$(ssh-keygen -lf $(DEPLOY_KEY) 2>/dev/null | awk '{print $$2}' || echo 'MISSING')"
	@echo "compare against the 'deploy key fingerprint' line in the workflow log"
	@ssh -F /dev/null -i $(DEPLOY_KEY) -o IdentitiesOnly=yes -o BatchMode=yes $(DROPLET) \
		'echo "connected as $$(whoami)"; ls -ld /srv/voiceover /srv/voiceover/bin 2>&1' \
		|| { echo; echo "Rejected. On the droplet, as root:"; \
		     echo "  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh"; \
		     echo "  echo '<contents of $(DEPLOY_KEY).pub>' >> /home/deploy/.ssh/authorized_keys"; \
		     echo "  chown deploy:deploy /home/deploy/.ssh/authorized_keys"; \
		     echo "  chmod 600 /home/deploy/.ssh/authorized_keys"; exit 1; }

deploy-scripts: ## Install deploy/quests/bin + ecosystem.config.js on the droplet
	$(RSYNC) -a -e "$(SSH)" deploy/quests/bin/ $(DROPLET):$(REMOTE_ROOT)/bin/
	$(RSYNC) -a -e "$(SSH)" deploy/quests/ecosystem.config.js $(DROPLET):$(REMOTE_ROOT)/shared/
	$(SSH) $(DROPLET) 'chmod +x $(REMOTE_ROOT)/bin/*.sh'
	@echo "==> installed"

releases: ## List releases on the droplet, marking the live one
	@$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh --list'

rollback: ## Roll back to the previous release (or RELEASE=<name>)
	$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh $(RELEASE)'

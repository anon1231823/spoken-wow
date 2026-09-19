# Entry points for the scripts under scripts/zones/ and pipelines/zones/tools/.
# Everything here is a thin wrapper -- the scripts remain runnable on their own.

.DEFAULT_GOAL := help
.PHONY: help package package-audio check validate validate-audio lint deploy deploy-copy \
        status remove clean voice voice-zones lookup import export \
        push push-dry pull pull-dry audio-status ssh-check pull-manifest \
        db-push db-pull \
        icon lore-import lore-export lore-check lore-rewrite aliases languages locale-check \
        release release-dry

# The \# escapes are required: an unescaped # starts a make comment, even
# inside a $(shell ...) call.
VERSION := $(shell sed -n 's/^\#\# Version:[[:space:]]*//p' addons/SpokenZones/SpokenZones.toc | head -1)
ZIP := dist/SpokenZones-$(VERSION).zip

help: ## Show this help
	@echo "ZoneLore $(VERSION)"
	@echo
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

package: check ## Build dist/SpokenZones-<version>.zip for upload
	@./scripts/zones/package.sh

check: validate lint locale-check ## Run every pre-package check

# descriptions, descriptions-check and descriptions-published moved to the root Makefile when
# the generator grew to cover every project's pages rather than only this one's.

validate: ## Sanity-check the generated Lua data files
	@node pipelines/zones/tools/validate.mjs

# The in-game addon list reads a TGA or BLP, never the PNG or SVG in pipelines/zones/assets/, so the
# icon is converted and committed. Both addons carry the same shield: they install as a
# pair, and two icons would imply they are alternatives to each other.
icon: ## Rebuild both addons' AddonIcon.tga from pipelines/zones/assets/spoken-zones-512.png (needs ffmpeg)
	@python3 pipelines/zones/tools/make-icon.py pipelines/zones/assets/spoken-zones-512.png addons/SpokenZones/Textures/AddonIcon.tga
	@cp addons/SpokenZones/Textures/AddonIcon.tga addons/SpokenZonesAudio/Textures/AddonIcon.tga
	@echo "==> copied to addons/SpokenZonesAudio/Textures/AddonIcon.tga"

lint: ## Block-balance check on the addon's Lua
	@python3 pipelines/zones/tools/lua-syntax-check.py

deploy: ## Symlink the addon into a client (CLIENT=era|anniversary)
	@./scripts/zones/deploy.sh

deploy-copy: ## Copy the addon into the client instead of symlinking
	@./scripts/zones/deploy.sh --copy

status: ## Show what is installed in every client
	@./scripts/zones/deploy.sh --status

remove: ## Uninstall the addon from every client
	@./scripts/zones/deploy.sh --remove

clean: ## Remove build output
	@rm -rf dist
	@echo "removed dist/"

#-------------------------------------------------------------------------------
# Voicelines
#
# None of these can spend a credit. They report on lines, build the addon's lookup
# table and check it; cutting audio is the site's, on the droplet. See README
# "Generating voicelines".
#-------------------------------------------------------------------------------

# The pipeline takes no language: the lore is English and the tools say so themselves.
# The addon keeps its locale data -- alias tables and interface strings, both keyed by
# CLIENT locale -- and `make zones-aliases` and `make zones-languages` still maintain it.
VOICE_LANG =

# The manifest comes from Postgres when DATABASE_URL is set and from the committed files
# otherwise, and pipelines/zones/.env sets it to the droplet -- so a laptop with no tunnel up
# gets ECONNREFUSED out of every audio target, which is not a failure anyone reading
# "validate the sound pack" expects.
#
# Passing it empty is what env.mjs documents as "use the files": an already-set variable always
# wins over .env. Defined-but-empty counts, so this is the default and
# `make zones-package-audio DATABASE_URL=postgres://...` still reads the database.
VOICE_DB = DATABASE_URL=$(DATABASE_URL)

voice: ## Report on every voiceline: what is missing, stale, and what it would cost
	@$(VOICE_LANG) node pipelines/zones/tools/voice/generate.mjs --all

voice-zones: ## The same, over the 49 zone lines only
	@$(VOICE_LANG) node pipelines/zones/tools/voice/generate.mjs --all --zones-only

lookup: ## Rebuild the addon's audio lookup table (exports the manifest first)
	@$(VOICE_LANG) node pipelines/zones/tools/voice/export-manifest.mjs
	@$(VOICE_LANG) $(VOICE_DB) node pipelines/zones/tools/voice/build-lookup.mjs

validate-audio: ## Check manifest, files on disk and lookup table agree (DATABASE_URL=... to use the droplet)
	@$(VOICE_LANG) $(VOICE_DB) node pipelines/zones/tools/voice/validate-audio.mjs

#-------------------------------------------------------------------------------
# The site's database
#
# Optional to the addon build: with DATABASE_URL unset every target above still
# works against pipelines/zones/tools/voice/manifest.json. The schema and its migrations
# belong to apps/web now; see make/web.mk and deploy/web/README.md.
#-------------------------------------------------------------------------------

import: ## Seed the database from pipelines/zones/tools/voice/manifest.json (idempotent)
	@$(VOICE_LANG) node pipelines/zones/tools/voice/import-manifest.mjs

export: ## Write pipelines/zones/tools/voice/manifest.json from the database
	@$(VOICE_LANG) node pipelines/zones/tools/voice/export-manifest.mjs

#-------------------------------------------------------------------------------
# The lore corpus
#
# The text lives in the database so it can be rewritten from the explorer, and the
# addon ships the two committed Lua files. These targets are the traffic between
# them. Neither is needed to build the addon from a clone: without DATABASE_URL the
# committed files are the whole story, which is what keeps the release path free of
# Postgres.
#-------------------------------------------------------------------------------

lore-import: ## Seed lore_line from the committed Lua data files (idempotent)
	@node pipelines/zones/tools/lore/import.mjs

lore-export: ## Write addons/SpokenZones/Data/enUS/*.lua from the database
	@node pipelines/zones/tools/lore/export.mjs

lore-check: ## Confirm the committed Lua matches the database
	@node pipelines/zones/tools/lore/export.mjs --check

# Translations arrive as a spreadsheet, not through a model: a sheet goes out with the
# English beside the blanks and comes back filled in. Both are free. The upload
# follows the scraper's rules -- unchanged text records nothing, and a hand edit made
# in the explorer is never overwritten -- so a re-upload is always safe to run.
lore-rewrite: ## Rewrite one zone's lore from the full wiki article (ZONE=1420, costs credits)
	@test -n "$(ZONE)" || { echo "usage: make lore-rewrite ZONE=1420"; exit 1; }
	@node pipelines/zones/tools/rewrite-lore.mjs --zone $(ZONE) --variant both --dry-run

#-------------------------------------------------------------------------------
# Languages
#
# A non-English client reports its own area names -- "Sengende Schlucht", not
# "Burning Steppes" -- and the corpus is keyed by the English one in every
# language. Without these tables such a client matches no subzone at all, which
# is what it did for the addon's whole life before they existed. Regenerate only
# when the pinned client build in pipelines/zones/tools/lib/db2.mjs moves.
#-------------------------------------------------------------------------------

aliases: ## Rebuild Data/<locale>/Aliases.lua from the client's AreaTable
	@node pipelines/zones/tools/locale/build-aliases.mjs
	@node pipelines/zones/tools/locale/build-languages.mjs

languages: ## Rebuild Data/Languages.lua -- what each language covers, and whether it ships
	@node pipelines/zones/tools/locale/build-languages.mjs

# Reports coverage and confirms Languages.lua still matches it. An untranslated
# language is not a failure; a stale Languages.lua is, because it decides which
# languages players are offered.
locale-check: ## Report per-language string coverage, and check Languages.lua is current
	@node pipelines/zones/tools/locale/check-strings.mjs
	@node pipelines/zones/tools/locale/build-languages.mjs --check

#-------------------------------------------------------------------------------
# The droplet
#
# The site is deployed by GitHub Actions on every push to master. Everything here is the
# half CI does not do: the audio store and the database contents. See deploy/web/README.md.
#
#   make push              ~700MB of mp3s, the first time and after a local bulk run
#   make db-push           seed the droplet's database from the local one
#
# Droplet setup, releases and rollback are make/web.mk's: one /srv/spoken tree, one
# deploy, one place holding the guards.
#-------------------------------------------------------------------------------

include make/droplet.mk

# /srv/spoken, not /srv/zonelore. The cutover has run: the sounds and the take history
# live under /srv/spoken/shared (symlinks into the block volume at /mnt/voice/spoken) and
# the `spoken` pm2 app serves them. REMOTE_ROOT is set in make/droplet.mk.


# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible"
# and rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# No -z: mp3 is already compressed, so it is pure CPU for ~0 gain.
# --delete keeps the two stores in exact correspondence, which is what makes the
# "missing" counts in the explorer trustworthy.
# -e is not optional: without it rsync spawns a plain ssh that cannot authenticate.
RSYNC_OPTS := -a --delete --partial --human-readable --info=progress2 -e "$(SSH)"

# The paths mirror soundsDir()/manifestPath() in pipelines/zones/tools/voice/store.mjs.
LOCAL_SOUNDS  := addons/SpokenZonesAudio/Sounds/
# Lowercase on the new store, where it was shared/Sounds on /srv/zonelore. The volume is
# case-sensitive, so the old spelling is a new empty directory rather than an error.
REMOTE_SOUNDS_DIR := sounds
MANIFEST_FILE := manifest.json
REMOTE_SOUNDS  := $(DROPLET):$(REMOTE_ROOT)/shared/$(REMOTE_SOUNDS_DIR)/
REMOTE_HISTORY := $(DROPLET):$(REMOTE_ROOT)/shared/audio-history/

# Fail with an explanation rather than an rsync usage dump or a bare publickey refusal.
define preflight
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. macOS ships openrsync, which lacks --info."; \
	                        echo "Install one:  brew install rsync"; exit 1; }
	@[ -f $(DEPLOY_KEY) ] || { echo "No deploy key at $(DEPLOY_KEY)."; \
	                           echo "It is the key the droplet's deploy user authorises."; \
	                           echo "Point at another with:  make $@ DEPLOY_KEY=~/.ssh/other"; exit 1; }
	@case "$(DROPLET)" in root@*) \
	  echo "DROPLET is $(DROPLET). Use deploy@ instead: pm2 daemons are per-user, so a"; \
	  echo "reload as root finds no 'zonelore' process and the new release stays unserved."; \
	  exit 1;; esac
endef

ssh-check: require-droplet ## Confirm the droplet is reachable and set up
	$(preflight)
	@$(SSH) $(DROPLET) 'echo "ok: $$(hostname)"; ls -d $(REMOTE_ROOT)/bin $(REMOTE_ROOT)/shared 2>/dev/null || echo "missing tree - run: make bootstrap"'

push-dry: ## Preview what `make push` would send to the droplet
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(LOCAL_SOUNDS) $(REMOTE_SOUNDS)

# --delete propagates local deletions, and the droplet is where regeneration happens
# through the UI, so it can be the newer side. `make pull` first if in doubt: this is a
# second copy of the audio, not a backup.
push: require-droplet ## Send the audio store to the droplet (DESTRUCTIVE: --delete)
	$(preflight)
	@echo "==> dry run (local -> $(DROPLET))"
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(LOCAL_SOUNDS) $(REMOTE_SOUNDS) | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@$(RSYNC) $(RSYNC_OPTS) $(LOCAL_SOUNDS) $(REMOTE_SOUNDS)
	@[ -d pipelines/zones/audio-history ] && $(RSYNC) $(RSYNC_OPTS) pipelines/zones/audio-history/ $(REMOTE_HISTORY) || true
	@echo "==> pushed"

pull-dry: ## Preview what `make pull` would change locally
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(REMOTE_SOUNDS) $(LOCAL_SOUNDS)

pull: require-droplet ## Fetch the audio store from the droplet (DESTRUCTIVE: --delete)
	$(preflight)
	@echo "==> dry run ($(DROPLET) -> local)"
	@echo "    --delete will REMOVE local files the droplet does not have."
	@mkdir -p $(LOCAL_SOUNDS)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(REMOTE_SOUNDS) $(LOCAL_SOUNDS) | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@$(RSYNC) $(RSYNC_OPTS) $(REMOTE_SOUNDS) $(LOCAL_SOUNDS)
	@[ -d pipelines/zones/audio-history ] && $(RSYNC) $(RSYNC_OPTS) $(REMOTE_HISTORY) pipelines/zones/audio-history/ || true
	@echo "==> pulled. Rebuild the lookup table with:  make db-pull && make lookup"
	@echo "    then package it with:  make package-audio"

# The one file the droplet writes that git wants back. The manifest is an export of the
# droplet's database, so `make db-pull` is the better route for it; this is the one that
# works when you only want the file.
pull-manifest: require-droplet ## Fetch the droplet's exported manifest.json
	@$(RSYNC) -a -e "$(SSH)" $(DROPLET):$(REMOTE_ROOT)/shared/$(MANIFEST_FILE) pipelines/zones/tools/voice/$(MANIFEST_FILE)
	@echo "==> fetched. Review with: git diff pipelines/zones/tools/voice/$(MANIFEST_FILE)"

audio-status: require-droplet ## What is on disk locally and on the droplet
	@printf 'local     live      %5s mp3  %s\n' \
		"$$(find $(LOCAL_SOUNDS) -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')" \
		"$$(du -sh $(LOCAL_SOUNDS) 2>/dev/null | cut -f1)"
	@printf 'local     archived  %5s mp3  %s\n' \
		"$$(find pipelines/zones/audio-history -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')" \
		"$$(du -sh pipelines/zones/audio-history 2>/dev/null | cut -f1)"
	@$(SSH) $(DROPLET) 'printf "droplet   live      %5s mp3  %s\n" \
		"$$(find $(REMOTE_ROOT)/shared/$(REMOTE_SOUNDS_DIR) -name "*.mp3" 2>/dev/null | wc -l | tr -d " ")" \
		"$$(du -sh $(REMOTE_ROOT)/shared/$(REMOTE_SOUNDS_DIR) 2>/dev/null | cut -f1)"; \
	  printf "droplet   archived  %5s mp3  %s\n" \
		"$$(find $(REMOTE_ROOT)/shared/audio-history -name "*.mp3" 2>/dev/null | wc -l | tr -d " ")" \
		"$$(du -sh $(REMOTE_ROOT)/shared/audio-history 2>/dev/null | cut -f1)"' 2>/dev/null \
	  || echo "droplet   unreachable (try: make ssh-check)"

#-------------------------------------------------------------------------------
# Moving the database between machines
#
# Data only, never schema: migrations own the schema on both sides, and a dump that
# carried DDL would fight them. pg_dump runs inside the local container so its version
# always matches the local server; psql on the droplet reads plain SQL, so a version
# difference between the two clusters does not matter.
#
# This is how the droplet gets seeded after its first deploy, and how the takes and
# flags it accumulates come home.
#-------------------------------------------------------------------------------

# Unquoted because both names are already all-lowercase; quoting them here would have to
# survive two levels of shell inside the ssh command below, and does not.
DUMP_TABLES := --table=voiceline_take --table=line_flag --table=lore_line
PGDUMP      := docker compose exec -T postgres pg_dump -U zonelore -d zonelore --data-only $(DUMP_TABLES)

# pg_dump 16.10 and later wrap their output in \restrict / \unrestrict, psql meta-commands
# that guard against a dump file from an untrusted source. A psql older than that fails on
# them, and the two clusters here are both ours, so strip them rather than requiring the
# droplet's psql to match the container's.
UNRESTRICT := sed -e '/^\\restrict/d' -e '/^\\unrestrict/d'

db-push: require-droplet ## Copy the local takes, flags and lore into the droplet's database (REPLACES them)
	@echo "local:"
	@docker compose exec -T postgres psql -U zonelore -d zonelore \
		-c 'select l."lang", (select count(*) from "voiceline_take" t where t."lang" = l."lang") as takes, (select count(*) from "line_flag" f where f."lang" = l."lang") as flags from (select "lang" from "voiceline_take" union select "lang" from "line_flag") l order by 1'
	@echo "droplet:"
	@$(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" \
		-c "select l.\"lang\", (select count(*) from \"voiceline_take\" t where t.\"lang\" = l.\"lang\") as takes, (select count(*) from \"line_flag\" f where f.\"lang\" = l.\"lang\") as flags from (select \"lang\" from \"voiceline_take\" union select \"lang\" from \"line_flag\") l order by 1"'
	@printf 'Replace the droplet contents with the local ones? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@( echo 'begin;'; \
	   echo 'truncate "voiceline_take", "line_flag", "lore_line";'; \
	   $(PGDUMP) | $(UNRESTRICT); \
	   echo 'commit;' ) \
	  | $(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -q'
	@echo "==> pushed"

db-pull: require-droplet ## Copy the droplet's takes, flags and lore into the local database (REPLACES them)
	@printf 'Replace the LOCAL database contents with the droplet ones? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@( echo 'begin;'; \
	   echo 'truncate "voiceline_take", "line_flag", "lore_line";'; \
	   $(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; pg_dump "$$DATABASE_URL" --data-only $(DUMP_TABLES)' | $(UNRESTRICT); \
	   echo 'commit;' ) \
	  | docker compose exec -T postgres psql -U zonelore -d zonelore -v ON_ERROR_STOP=1 -q
	@echo "==> pulled. Bring the addon into step with:  make lore-export && make lookup"

#-------------------------------------------------------------------------------
# Deploying
#-------------------------------------------------------------------------------

package-audio: validate-audio ## Build the sound-pack zip
	@./scripts/zones/package-audio.sh

release-dry: ## Show what `make release` would upload to CurseForge
	@./scripts/zones/release.sh --dry-run

release: ## Upload the built zips to CurseForge (needs CURSEFORGE_TOKEN)
	@./scripts/zones/release.sh

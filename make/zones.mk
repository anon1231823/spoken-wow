# Entry points for the scripts under scripts/ and tools/.
# Everything here is a thin wrapper -- the scripts remain runnable on their own.

.DEFAULT_GOAL := help
.PHONY: help package package-audio check validate validate-audio lint deploy deploy-copy \
        status remove clean voice voice-zones lookup sample db-up db-down migrate import export \
        web push push-dry pull pull-dry audio-status ssh-check pull-manifest \
        db-push db-pull bootstrap deploy-scripts releases rollback logs \
        icon lore-import lore-export lore-check lore-sheet lore-upload lore-upload-dry lore-rewrite aliases languages locale-check \
        release release-dry descriptions descriptions-check descriptions-published

# The \# escapes are required: an unescaped # starts a make comment, even
# inside a $(shell ...) call.
VERSION := $(shell sed -n 's/^\#\# Version:[[:space:]]*//p' addon/ZoneLore/ZoneLore.toc | head -1)
ZIP := dist/ZoneLore-$(VERSION).zip

help: ## Show this help
	@echo "ZoneLore $(VERSION)"
	@echo
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

package: check ## Build dist/ZoneLore-<version>.zip for upload
	@./scripts/package.sh

check: validate lint locale-check descriptions-check ## Run every pre-package check

descriptions: ## Regenerate the addon READMEs and dist/descriptions/ from curseforge/
	@node tools/descriptions.mjs --write

descriptions-check: ## Confirm the addon READMEs match curseforge/
	@node tools/descriptions.mjs

descriptions-published: ## Record the current descriptions as pasted into the site
	@node tools/descriptions.mjs --published

validate: ## Sanity-check the generated Lua data files
	@node tools/validate.mjs

# The in-game addon list reads a TGA or BLP, never the PNG or SVG in assets/, so the
# icon is converted and committed. Both addons carry the same shield: they install as a
# pair, and two icons would imply they are alternatives to each other.
icon: ## Rebuild both addons' AddonIcon.tga from assets/zonelore-512.png (needs ffmpeg)
	@python3 tools/make-icon.py assets/zonelore-512.png addon/ZoneLore/Textures/AddonIcon.tga
	@cp addon/ZoneLore/Textures/AddonIcon.tga addon/ZoneLoreAudio/Textures/AddonIcon.tga
	@echo "==> copied to addon/ZoneLoreAudio/Textures/AddonIcon.tga"

lint: ## Block-balance check on the addon's Lua
	@python3 tools/lua-syntax-check.py

deploy: ## Symlink the addon into a client (CLIENT=era|anniversary)
	@./scripts/deploy.sh

deploy-copy: ## Copy the addon into the client instead of symlinking
	@./scripts/deploy.sh --copy

status: ## Show what is installed in every client
	@./scripts/deploy.sh --status

remove: ## Uninstall the addon from every client
	@./scripts/deploy.sh --remove

clean: ## Remove build output
	@rm -rf dist
	@echo "removed dist/"

#-------------------------------------------------------------------------------
# Voicelines
#
# Every target here that costs money says so and needs --generate spelled out;
# the bare ones are all dry runs. See README "Generating voicelines".
#-------------------------------------------------------------------------------

# Every voice target takes LOCALE=deDE and defaults to English, the same way the lore
# targets do (see the LOCALE note there): pinned here rather than inherited, so a
# ZONELORE_LANG left in the shell from an earlier run cannot quietly point a dry run,
# an import or a lookup rebuild at another language's files.
VOICE_LANG = ZONELORE_LANG=$(or $(LOCALE),enUS)

voice: ## Dry run over every voiceline (costs nothing; LOCALE=deDE for another language)
	@$(VOICE_LANG) node tools/voice/generate.mjs --all

voice-zones: ## Dry run over the 49 zone lines (costs nothing)
	@$(VOICE_LANG) node tools/voice/generate.mjs --all --zones-only

sample: ## Generate two sample lines to audio-samples/ (SPENDS CREDITS)
	@$(VOICE_LANG) node tools/voice/generate.mjs --sample

lookup: ## Rebuild the addon's audio lookup table (exports the manifest first)
	@$(VOICE_LANG) node tools/voice/export-manifest.mjs
	@$(VOICE_LANG) node tools/voice/build-lookup.mjs

validate-audio: ## Check manifest, files on disk and lookup table agree
	@$(VOICE_LANG) node tools/voice/validate-audio.mjs

#-------------------------------------------------------------------------------
# The explorer's database
#
# Optional to the addon build: with DATABASE_URL unset every target above still
# works against tools/voice/manifest.json. See README "The voiceline explorer".
#-------------------------------------------------------------------------------

db-up: ## Start Postgres for the explorer (port 5433)
	@docker compose up -d
	@./scripts/migrate.sh

db-down: ## Stop it, keeping the data
	@docker compose stop

migrate: ## Apply any pending migrations
	@./scripts/migrate.sh

import: ## Seed the database from tools/voice/manifest[.<locale>].json (idempotent; LOCALE=deDE)
	@$(VOICE_LANG) node tools/voice/import-manifest.mjs

export: ## Write tools/voice/manifest[.<locale>].json from the database (LOCALE=deDE)
	@$(VOICE_LANG) node tools/voice/export-manifest.mjs

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
	@node tools/lore/import.mjs

# LOCALE, not LANG: make inherits LANG from the shell, where it is already set to
# something like en_US.UTF-8, and the export would be handed that as a locale code.
lore-export: ## Write addon/ZoneLore/Data/<locale>/*.lua from the database (LOCALE=deDE)
	@ZONELORE_LANG=$(or $(LOCALE),enUS) node tools/lore/export.mjs

lore-check: ## Confirm the committed Lua matches the database
	@ZONELORE_LANG=$(or $(LOCALE),enUS) node tools/lore/export.mjs --check

# Translations arrive as a spreadsheet, not through a model: a sheet goes out with the
# English beside the blanks and comes back filled in. Both are free. The upload
# follows the scraper's rules -- unchanged text records nothing, and a hand edit made
# in the explorer is never overwritten -- so a re-upload is always safe to run.
lore-sheet: ## Write the CSV a translator fills in (LOCALE=deDE, OUT=dist/lore-deDE.csv)
	@ZONELORE_LANG=$(LOCALE) node tools/lore/translation-sheet.mjs $(or $(OUT),dist/lore-$(LOCALE).csv)

lore-upload-dry: ## Say what uploading a filled sheet would record (LOCALE=deDE FILE=...)
	@ZONELORE_LANG=$(LOCALE) node tools/lore/upload-translations.mjs $(FILE) --dry-run

lore-upload: ## Record a filled sheet as that language's lore (LOCALE=deDE FILE=...)
	@ZONELORE_LANG=$(LOCALE) node tools/lore/upload-translations.mjs $(FILE)

# Unlike every other target here, this one spends money: it sends each of a zone's
# articles to Claude. There is no free form of it -- the report *is* the model's
# output -- so the target is the dry run, which writes dist/ and nothing else, and
# committing the result means running the script directly with one --variant and no
# --dry-run. Responses are cached on disk, so re-running a zone is free.
lore-rewrite: ## Rewrite one zone's lore from the full wiki article (ZONE=1420, costs credits)
	@test -n "$(ZONE)" || { echo "usage: make lore-rewrite ZONE=1420"; exit 1; }
	@node tools/rewrite-lore.mjs --zone $(ZONE) --variant both --dry-run

#-------------------------------------------------------------------------------
# Languages
#
# A non-English client reports its own area names -- "Sengende Schlucht", not
# "Burning Steppes" -- and the corpus is keyed by the English one in every
# language. Without these tables such a client matches no subzone at all, which
# is what it did for the addon's whole life before they existed. Regenerate only
# when the pinned client build in tools/lib/db2.mjs moves.
#-------------------------------------------------------------------------------

aliases: ## Rebuild Data/<locale>/Aliases.lua from the client's AreaTable
	@node tools/locale/build-aliases.mjs
	@node tools/locale/build-languages.mjs

languages: ## Rebuild Data/Languages.lua -- what each language covers, and whether it ships
	@node tools/locale/build-languages.mjs

# Reports coverage and confirms Languages.lua still matches it. An untranslated
# language is not a failure; a stale Languages.lua is, because it decides which
# languages players are offered.
locale-check: ## Report per-language string coverage, and check Languages.lua is current
	@node tools/locale/check-strings.mjs
	@node tools/locale/build-languages.mjs --check

web: ## Run the voiceline explorer at localhost:3000
	@cd web && pnpm dev

#-------------------------------------------------------------------------------
# The droplet
#
# The explorer runs at https://lore.rusty.one, deployed by GitHub Actions on every
# push to master. Everything here is the half CI does not do: the audio store, the
# database contents, and installing the scripts CI calls. See deploy/README.md.
#
#   make bootstrap         once, as root: user, /srv tree, database
#   make deploy-scripts    after that, and after editing deploy/bin/*
#   make push              ~700MB of mp3s, the first time and after a local bulk run
#   make db-push           seed the droplet's database from the local one
#   make releases          what is deployed
#   make rollback          undo a bad deploy
#-------------------------------------------------------------------------------

# Connect as deploy, never root: pm2 daemons are per-user, so a reload over an ssh
# session as root talks to root's empty daemon and silently does nothing. The hostname
# resolves to the droplet today; override with the IP if it is ever pointed at a CDN,
# which would not proxy SSH:  make push DROPLET=deploy@188.166.37.175
DROPLET     ?= deploy@rusty.one
REMOTE_ROOT ?= /srv/zonelore

# The same key ../wow-voiceover uses for the same droplet, and the same reason for
# -o IdentitiesOnly=yes: ~/.ssh/config here has a `Host *` block naming IdentityFile,
# which REPLACES the default identity list rather than adding to it. A bare `ssh` then
# offers only those keys, the deploy user authorises this one, and the failure is a flat
# "Permission denied (publickey)" that names neither the key it tried nor the one it
# wanted. This is also the key CI authenticates with, so `make ssh-check` tests what a
# deploy actually does.
DEPLOY_KEY ?= ~/.ssh/id_rusty.one
SSH        ?= ssh -i $(DEPLOY_KEY) -o IdentitiesOnly=yes

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

# One language per transfer, LOCALE=deDE, defaulting to English. The paths mirror
# soundsDir()/manifestPath() in tools/voice/store.mjs: English keeps the names the
# droplet already has (shared/Sounds, shared/manifest.json), and another language
# lives beside them under its pack folder and a suffixed manifest. audio-history/
# nests every language under one tree, so it moves whole regardless of LOCALE.
LANG_CODE := $(or $(LOCALE),enUS)
ifeq ($(LANG_CODE),enUS)
LOCAL_SOUNDS  := addon/ZoneLoreAudio/Sounds/
REMOTE_SOUNDS_DIR := Sounds
MANIFEST_FILE := manifest.json
else
LOCAL_SOUNDS  := addon/ZoneLoreAudio_$(LANG_CODE)/Sounds/
REMOTE_SOUNDS_DIR := ZoneLoreAudio_$(LANG_CODE)
MANIFEST_FILE := manifest.$(LANG_CODE).json
endif
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

ssh-check: ## Confirm the droplet is reachable and set up
	$(preflight)
	@$(SSH) $(DROPLET) 'echo "ok: $$(hostname)"; ls -d $(REMOTE_ROOT)/bin $(REMOTE_ROOT)/shared 2>/dev/null || echo "missing tree - run: make bootstrap"'

push-dry: ## Preview what `make push` would send to the droplet (LOCALE=deDE)
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(LOCAL_SOUNDS) $(REMOTE_SOUNDS)

# --delete propagates local deletions, and the droplet is where regeneration happens
# through the UI, so it can be the newer side. `make pull` first if in doubt: this is a
# second copy of the audio, not a backup.
push: ## Send one language's audio store to the droplet (DESTRUCTIVE: --delete; LOCALE=deDE)
	$(preflight)
	@echo "==> dry run ($(LANG_CODE): local -> $(DROPLET))"
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(LOCAL_SOUNDS) $(REMOTE_SOUNDS) | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@$(RSYNC) $(RSYNC_OPTS) $(LOCAL_SOUNDS) $(REMOTE_SOUNDS)
	@[ -d audio-history ] && $(RSYNC) $(RSYNC_OPTS) audio-history/ $(REMOTE_HISTORY) || true
	@echo "==> pushed"

pull-dry: ## Preview what `make pull` would change locally (LOCALE=deDE)
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(REMOTE_SOUNDS) $(LOCAL_SOUNDS)

pull: ## Fetch one language's audio store from the droplet (DESTRUCTIVE: --delete; LOCALE=deDE)
	$(preflight)
	@echo "==> dry run ($(LANG_CODE): $(DROPLET) -> local)"
	@echo "    --delete will REMOVE local files the droplet does not have."
	@mkdir -p $(LOCAL_SOUNDS)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(REMOTE_SOUNDS) $(LOCAL_SOUNDS) | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@$(RSYNC) $(RSYNC_OPTS) $(REMOTE_SOUNDS) $(LOCAL_SOUNDS)
	@[ -d audio-history ] && $(RSYNC) $(RSYNC_OPTS) $(REMOTE_HISTORY) audio-history/ || true
	@echo "==> pulled. Rebuild the lookup table with:  make db-pull && make lookup LOCALE=$(LANG_CODE)"
	@echo "    then package it with:  make package-audio LOCALE=$(LANG_CODE)"

# The one file the droplet writes that git wants back. The manifest is an export of the
# droplet's database, so `make db-pull` is the better route for it; this is the one that
# works when you only want the file.
pull-manifest: ## Fetch the droplet's exported manifest[.<locale>].json (LOCALE=deDE)
	@$(RSYNC) -a -e "$(SSH)" $(DROPLET):$(REMOTE_ROOT)/shared/$(MANIFEST_FILE) tools/voice/$(MANIFEST_FILE)
	@echo "==> fetched. Review with: git diff tools/voice/$(MANIFEST_FILE)"

audio-status: ## What is on disk locally and on the droplet (LOCALE=deDE)
	@echo "$(LANG_CODE)"
	@printf 'local     live      %5s mp3  %s\n' \
		"$$(find $(LOCAL_SOUNDS) -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')" \
		"$$(du -sh $(LOCAL_SOUNDS) 2>/dev/null | cut -f1)"
	@printf 'local     archived  %5s mp3  %s\n' \
		"$$(find audio-history -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')" \
		"$$(du -sh audio-history 2>/dev/null | cut -f1)"
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

db-push: ## Copy the local takes, flags and lore into the droplet's database (REPLACES them)
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

db-pull: ## Copy the droplet's takes, flags and lore into the local database (REPLACES them)
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

# One target rather than a documented scp-then-ssh pair, because the two halves get
# separated: run on its own, the ssh half reports only "No such file or directory" and
# names neither what is missing nor why.
#
# ROOT_SSH, not SSH: bootstrap creates the deploy user and the /srv tree, so it cannot
# run as the user it is about to create.
DROPLET_HOST := $(word 2,$(subst @, ,$(DROPLET)))

# Plain ssh, not $(SSH): root is reached with whatever key ~/.ssh/config already offers
# for this host -- that is how you administer the box -- whereas DEPLOY_KEY is specific
# to the unprivileged deploy user, which this target is about to create. Override if
# root wants a particular key:  make bootstrap ROOT_SSH_OPTS='-i ~/.ssh/other'
ROOT_SSH_OPTS ?=

bootstrap: ## One-time droplet setup, as root (idempotent)
	@echo "==> copying deploy/bootstrap.sh to root@$(DROPLET_HOST)"
	@$(RSYNC) -a -e "ssh $(ROOT_SSH_OPTS)" deploy/bootstrap.sh root@$(DROPLET_HOST):/tmp/zonelore-bootstrap.sh
	@ssh $(ROOT_SSH_OPTS) root@$(DROPLET_HOST) 'bash /tmp/zonelore-bootstrap.sh; rm -f /tmp/zonelore-bootstrap.sh'

deploy-scripts: ## Install deploy/bin + ecosystem.config.js on the droplet
	@$(RSYNC) -a -e "$(SSH)" deploy/bin/ $(DROPLET):$(REMOTE_ROOT)/bin/
	@$(RSYNC) -a -e "$(SSH)" deploy/ecosystem.config.js $(DROPLET):$(REMOTE_ROOT)/shared/
	@$(SSH) $(DROPLET) 'chmod +x $(REMOTE_ROOT)/bin/*.sh'
	@echo "==> installed"

releases: ## List releases on the droplet, marking the live one
	@$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh --list'

rollback: ## Roll back to the previous release (or RELEASE=<name>)
	@$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh $(RELEASE)'

logs: ## Tail the droplet's application log
	@$(SSH) $(DROPLET) 'pm2 logs zonelore --lines 100'

package-audio: validate-audio ## Build both sound-pack zips (standard + high)
	@./scripts/package-audio.sh

release-dry: ## Show what `make release` would upload to CurseForge
	@./scripts/release.sh --dry-run

release: ## Upload the built zips to CurseForge (needs CURSEFORGE_TOKEN)
	@./scripts/release.sh

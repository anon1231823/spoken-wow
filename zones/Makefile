# Entry points for the scripts under scripts/ and tools/.
# Everything here is a thin wrapper -- the scripts remain runnable on their own.

.DEFAULT_GOAL := help
.PHONY: help package package-audio check validate validate-audio lint deploy deploy-copy \
        status remove clean voice voice-zones lookup sample db-up db-down migrate import export \
        web push push-dry pull pull-dry audio-status

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

check: validate lint ## Run every pre-package check

validate: ## Sanity-check the generated Lua data files
	@node tools/validate.mjs

lint: ## Block-balance check on the addon's Lua
	@python3 tools/lua-syntax-check.py

deploy: ## Symlink the addon into the Classic Era client
	@./scripts/deploy.sh

deploy-copy: ## Copy the addon into the client instead of symlinking
	@./scripts/deploy.sh --copy

status: ## Show what is currently installed in the client
	@./scripts/deploy.sh --status

remove: ## Uninstall the addon from the client
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

voice: ## Dry run over every voiceline (costs nothing)
	@node tools/voice/generate.mjs --all

voice-zones: ## Dry run over the 49 zone lines (costs nothing)
	@node tools/voice/generate.mjs --all --zones-only

sample: ## Generate two sample lines to audio-samples/ (SPENDS CREDITS)
	@node tools/voice/generate.mjs --sample

lookup: ## Rebuild the addon's audio lookup table (exports the manifest first)
	@node tools/voice/export-manifest.mjs
	@node tools/voice/build-lookup.mjs

validate-audio: ## Check manifest, files on disk and lookup table agree
	@node tools/voice/validate-audio.mjs

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

import: ## Seed the database from tools/voice/manifest.json (idempotent)
	@node tools/voice/import-manifest.mjs

export: ## Write tools/voice/manifest.json from the database
	@node tools/voice/export-manifest.mjs

web: ## Run the voiceline explorer at localhost:3000
	@cd web && pnpm dev

#-------------------------------------------------------------------------------
# Moving the audio between machines
#
# 1353 mp3s, ~700MB with the archive, gitignored and never in CI. It moves by
# rsync, only when you say so. Override the target:
#
#   make pull REMOTE=user@host:/srv/zonelore
#-------------------------------------------------------------------------------

REMOTE ?=

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible"
# and rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# No -z: mp3 is already compressed, so it is pure CPU for ~0 gain.
# --delete keeps the two stores in exact correspondence, which is what makes the
# "missing" counts in the explorer trustworthy.
RSYNC_OPTS := -a --delete --partial --human-readable --info=progress2

define preflight
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. macOS ships openrsync, which lacks --info."; \
	                        echo "Install one:  brew install rsync"; exit 1; }
	@[ -n "$(REMOTE)" ] || { echo "REMOTE is not set. Example:"; \
	                         echo "  make $@ REMOTE=user@host:/srv/zonelore"; exit 1; }
endef

push-dry: ## Preview what `make push` would send
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run addon/ZoneLoreAudio/Sounds/ $(REMOTE)/Sounds/

push: ## Send the audio store to REMOTE
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) addon/ZoneLoreAudio/Sounds/ $(REMOTE)/Sounds/
	@[ -d audio-history ] && $(RSYNC) $(RSYNC_OPTS) audio-history/ $(REMOTE)/audio-history/ || true

pull-dry: ## Preview what `make pull` would change locally
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(REMOTE)/Sounds/ addon/ZoneLoreAudio/Sounds/

pull: ## Fetch the audio store from REMOTE
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) $(REMOTE)/Sounds/ addon/ZoneLoreAudio/Sounds/
	@$(MAKE) --no-print-directory validate-audio

audio-status: ## What is on disk locally
	@printf 'live      %5s mp3  %s\n' \
		"$$(find addon/ZoneLoreAudio/Sounds -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')" \
		"$$(du -sh addon/ZoneLoreAudio/Sounds 2>/dev/null | cut -f1)"
	@printf 'archived  %5s mp3  %s\n' \
		"$$(find audio-history -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')" \
		"$$(du -sh audio-history 2>/dev/null | cut -f1)"

package-audio: validate-audio ## Build dist/ZoneLoreAudio-<version>.zip
	@./scripts/package-audio.sh

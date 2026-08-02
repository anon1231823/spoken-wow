# Entry points for the scripts under scripts/ and tools/.
# Everything here is a thin wrapper -- the scripts remain runnable on their own.

.DEFAULT_GOAL := help
.PHONY: help package package-audio check validate validate-audio lint deploy deploy-copy status remove clean voice voice-zones lookup sample

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

lookup: ## Rebuild the addon's audio lookup table from the manifest
	@node tools/voice/build-lookup.mjs

validate-audio: ## Check manifest, files on disk and lookup table agree
	@node tools/voice/validate-audio.mjs

package-audio: validate-audio ## Build dist/ZoneLoreAudio-<version>.zip
	@./scripts/package-audio.sh

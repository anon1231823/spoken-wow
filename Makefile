# Spoken -- the dispatcher.
#
# The two projects keep their own Makefiles. They collide on fifteen target names
# (help, package, release, push, pull, rollback and the rest) and each target is
# commented with the failure it exists to prevent, several of them guarding an
# rsync --delete against audio that cannot be regenerated. Merging them is a
# semantic rewrite of about a hundred targets with nothing to show for it, so
# they are dispatched instead and the prefix disambiguates:
#
#     make quests-package        ->  make -f make/quests.mk package
#     make zones-release-dry     ->  make -f make/zones.mk  release-dry
#
# Both .mk files use paths relative to the repo root, so they must be run from
# here -- which is what the pattern rules below guarantee.

.DEFAULT_GOAL := help

LUA ?= $(shell command -v luajit || command -v lua5.1)

.PHONY: help test test-player lint package-all

help: ## Show this help
	@printf 'Spoken\n\n'
	@printf '  make quests-<target>   see make/quests.mk  (make quests-help)\n'
	@printf '  make zones-<target>    see make/zones.mk   (make zones-help)\n\n'
	@printf 'Repo-wide:\n'
	@grep -E '^[a-z-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) \
	  | sed 's/:.*## /|/' | awk -F'|' '{printf "  %-16s %s\n", $$1, $$2}'

quests-%:
	@$(MAKE) --no-print-directory -f make/quests.mk $*

zones-%:
	@$(MAKE) --no-print-directory -f make/zones.mk $*

test-player: ## Run the addons' Lua tests (needs luajit)
	@[ -n "$(LUA)" ] || { echo "No luajit found: brew install luajit"; exit 1; }
	@$(LUA) tests/lua/quest_dispatch_test.lua
	@$(LUA) tests/lua/easter_egg_test.lua
	@$(LUA) tests/lua/sound_utils_test.lua
	@$(LUA) tests/lua/queue_test.lua
	@$(LUA) tests/lua/sources_test.lua
	@$(LUA) tests/lua/api_contract_test.lua
	@$(LUA) tests/lua/player_frame_test.lua
	@$(LUA) tests/lua/zones_source_test.lua
	@$(LUA) tests/lua/quests_source_test.lua
	@$(LUA) tests/lua/data_modules_test.lua
	@$(LUA) tests/lua/migration_test.lua

test: test-player ## Everything: both webs, the Python pipeline, the addons
	@pnpm -r test
	@cd pipelines/quests && ./.venv/bin/python -m pytest -q

lint: ## The checks CI gates on
	@pnpm -r typecheck
	@node pipelines/zones/tools/validate.mjs
	@node pipelines/zones/tools/descriptions.mjs --check
	@node pipelines/zones/tools/locale/check-strings.mjs

package-all: ## Build every addon zip: the player, quests, zones
	@./scripts/spoken/package.sh
	@$(MAKE) --no-print-directory -f make/quests.mk package
	@$(MAKE) --no-print-directory -f make/zones.mk  package

# The website.
#
# apps/web is the unified site: the quests explorer today, the zones one as it is
# ported in. Deploy plumbing still lives in make/quests.mk, because the droplet tree
# it talks to is still /srv/voiceover -- both move here at cutover.
#
#     make web-dev           ->  make -f make/web.mk dev
#
# Run from the repo root; the root Makefile's pattern rule guarantees that.

.DEFAULT_GOAL := help
.PHONY: help dev build typecheck test

APP := @spoken/web

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) \
	  | sed 's/:.*## /|/' | awk -F'|' '{printf "  %-14s %s\n", $$1, $$2}'

dev: ## Run the site locally (needs a Postgres; see apps/web/.env.example)
	@pnpm --filter $(APP) dev

build: ## Production build, as CI does it
	@pnpm --filter $(APP) build

typecheck: ## Typecheck only
	@pnpm --filter $(APP) typecheck

test: ## Vitest (several suites need a real Postgres)
	@pnpm --filter $(APP) test

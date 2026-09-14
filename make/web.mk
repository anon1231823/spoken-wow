# The website: the app's own targets, and the droplet it runs on.
#
#     make web-dev           ->  make -f make/web.mk dev
#
# Run from the repo root; the root Makefile's pattern rule guarantees that.
#
# The audio stores are NOT synced from here. They belong to the two pipelines and stay in
# make/quests.mk and make/zones.mk, whose rsync targets carry the guards -- several of them
# run with --delete against directories holding audio that cannot be regenerated, and
# splitting those guards across two files is how one of them gets lost. Those two files
# still name the OLD droplet trees; `cutover-audio` below is what moves their contents, and
# flipping their REMOTE_ROOT is a step in the runbook rather than something done early.

.DEFAULT_GOAL := help
.PHONY: help dev build typecheck test bootstrap deploy-scripts releases rollback logs \
        ssh-check cutover-audio migrate-legacy migrate-legacy-dry

APP := @spoken/web

# Connect as deploy, never root: pm2 daemons are per-user, so `pm2 reload` over an ssh
# session as root talks to root's empty daemon and silently does nothing.
DROPLET     ?= deploy@188.166.37.175
REMOTE_ROOT := /srv/spoken

# The two trees this one replaces. Read by cutover-audio, and by nothing else.
OLD_QUESTS := /srv/voiceover
OLD_ZONES  := /srv/zonelore

# The key CI authenticates with, so `make web-ssh-check` tests what CI actually does.
DEPLOY_KEY ?= ~/.ssh/id_rusty.one
SSH        := ssh -i $(DEPLOY_KEY) -o IdentitiesOnly=yes

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) \
	  | sed 's/:.*## /|/' | awk -F'|' '{printf "  %-18s %s\n", $$1, $$2}'

#------------------------------------------------------------------------------
# Local
#------------------------------------------------------------------------------

dev: ## Run the site locally (needs a Postgres; see apps/web/.env.example)
	@pnpm --filter $(APP) dev

build: ## Production build, as CI does it
	@pnpm --filter $(APP) build

typecheck: ## Typecheck only
	@pnpm --filter $(APP) typecheck

test: ## Vitest (several suites need a real Postgres)
	@pnpm --filter $(APP) test

#------------------------------------------------------------------------------
# Droplet
#------------------------------------------------------------------------------

bootstrap: ## Print the first-time setup for /srv/spoken (run it on the droplet as root)
	@cat deploy/web/bootstrap.sh

deploy-scripts: ## Install deploy/web/bin + ecosystem.config.js on the droplet
	$(RSYNC) -a -e "$(SSH)" deploy/web/bin/ $(DROPLET):$(REMOTE_ROOT)/bin/
	$(RSYNC) -a -e "$(SSH)" deploy/web/ecosystem.config.js $(DROPLET):$(REMOTE_ROOT)/shared/
	$(SSH) $(DROPLET) 'chmod +x $(REMOTE_ROOT)/bin/*.sh'
	@echo "==> installed"

releases: ## List releases on the droplet, marking the live one
	@$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh --list'

rollback: ## Roll back to the previous release (or RELEASE=<name>)
	$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh $(RELEASE)'

logs: ## Tail the app's pm2 log
	$(SSH) $(DROPLET) 'pm2 logs spoken --lines 100'

ssh-check: ## Test the CI deploy key against the droplet, as CI authenticates
	@echo "local  $(DEPLOY_KEY): $$(ssh-keygen -lf $(DEPLOY_KEY) 2>/dev/null | awk '{print $$2}' || echo 'MISSING')"
	@echo "compare against the 'deploy key fingerprint' line in the workflow log"
	@ssh -F /dev/null -i $(DEPLOY_KEY) -o IdentitiesOnly=yes -o BatchMode=yes $(DROPLET) \
		'echo "connected as $$(whoami)"; ls -ld $(REMOTE_ROOT) $(REMOTE_ROOT)/bin 2>&1'

#------------------------------------------------------------------------------
# Cutover
#------------------------------------------------------------------------------

cutover-audio: ## Copy both old sites' shared/ into /srv/spoken/shared (COPIES, never moves)
	@echo "==> copying ~1.9 GB on the droplet; the old trees are left whole"
	$(SSH) $(DROPLET) 'set -eu; \
	  mkdir -p $(REMOTE_ROOT)/shared/audio-history; \
	  cp -an $(OLD_QUESTS)/shared/audio           $(REMOTE_ROOT)/shared/audio; \
	  cp -an $(OLD_QUESTS)/shared/voices          $(REMOTE_ROOT)/shared/voices; \
	  cp -an $(OLD_QUESTS)/shared/audio-previews  $(REMOTE_ROOT)/shared/audio-previews; \
	  cp -an $(OLD_QUESTS)/shared/downloads       $(REMOTE_ROOT)/shared/downloads; \
	  cp -an $(OLD_QUESTS)/shared/audio-history   $(REMOTE_ROOT)/shared/audio-history/quests; \
	  cp -an $(OLD_ZONES)/shared/Sounds           $(REMOTE_ROOT)/shared/sounds; \
	  cp -an $(OLD_ZONES)/shared/audio-history    $(REMOTE_ROOT)/shared/audio-history/zones; \
	  cp -an $(OLD_ZONES)/shared/manifest.json    $(REMOTE_ROOT)/shared/manifest.json; \
	  chown -R deploy:deploy $(REMOTE_ROOT)/shared || true; \
	  du -sh $(REMOTE_ROOT)/shared/*'
	@echo "==> copied. The old trees still hold their own copies; delete them only after the rollback window."

# COPIES, never moves, and `cp -an` never overwrites. The old trees are the rollback: if
# spoken.rusty.one has to be stood down, the two old apps start again against audio that
# was never touched. Disk is the cheap half of that trade.

migrate-legacy-dry: ## Rehearse the zones import into the new database (writes nothing)
	@node apps/web/scripts/migrate-legacy.mjs --dry-run

migrate-legacy: ## Import the zones data into the new database (once, at cutover)
	@node apps/web/scripts/migrate-legacy.mjs

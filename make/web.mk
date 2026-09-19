# The website: the app's own targets, and the droplet it runs on.
#
#     make web-dev           ->  make -f make/web.mk dev
#
# Run from the repo root; the root Makefile's pattern rule guarantees that.
#
# The audio stores are NOT synced from here. They belong to the two pipelines and stay in
# make/quests.mk and make/zones.mk, whose rsync targets carry the guards -- several of them
# run with --delete against directories holding audio that cannot be regenerated, and
# splitting those guards across two files is how one of them gets lost.

.DEFAULT_GOAL := help
.PHONY: help dev build typecheck test bootstrap deploy-scripts releases rollback logs \
        ssh-check store migrate-books

APP := @spoken/web

include make/droplet.mk


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

dev: ## Run the site locally (needs a Postgres; see .env.example and apps/web/.env.example)
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

store: ## Print the /mnt/voice setup (run it on the droplet as root)
	@cat deploy/web/store.sh

deploy-scripts: require-droplet ## Install deploy/web/bin + ecosystem.config.js on the droplet
	$(RSYNC) -a -e "$(SSH)" deploy/web/bin/ $(DROPLET):$(REMOTE_ROOT)/bin/
	$(RSYNC) -a -e "$(SSH)" deploy/web/ecosystem.config.js $(DROPLET):$(REMOTE_ROOT)/shared/
	$(SSH) $(DROPLET) 'chmod +x $(REMOTE_ROOT)/bin/*.sh'
	@echo "==> installed"

releases: require-droplet ## List releases on the droplet, marking the live one
	@$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh --list'

rollback: require-droplet ## Roll back to the previous release (or RELEASE=<name>)
	$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh $(RELEASE)'

logs: require-droplet ## Tail the app's pm2 log
	$(SSH) $(DROPLET) 'pm2 logs spoken --lines 100'

ssh-check: require-droplet ## Test the CI deploy key against the droplet, as CI authenticates
	@echo "local  $(DEPLOY_KEY): $$(ssh-keygen -lf $(DEPLOY_KEY) 2>/dev/null | awk '{print $$2}' || echo 'MISSING')"
	@echo "compare against the 'deploy key fingerprint' line in the workflow log"
	@ssh -F /dev/null -i $(DEPLOY_KEY) -o IdentitiesOnly=yes -o BatchMode=yes $(DROPLET) \
		'echo "connected as $$(whoami)"; ls -ld $(REMOTE_ROOT) $(REMOTE_ROOT)/bin 2>&1'

#-------------------------------------------------------------------------------
# The books corpus
#
# Its own path, because books cannot be seeded the way the other two are. The quests corpus
# ships inside the release as a committed file and the zones one is imported from the other
# droplet's database; books is extracted from a vmangos MySQL that exists only on a
# maintainer's machine, so the rows travel from there or not at all.
#
# THE DROPLET CANNOT RE-SEED ITSELF. If this table is ever lost there, it comes back from a
# local extract and this target -- which is the reason it is a target rather than a command
# somebody remembers.
#-------------------------------------------------------------------------------

# The native local Postgres, not a container: the books pipeline writes to whatever
# DATABASE_URL names, and this is where it has been run.
LOCAL_DB ?= postgres://localhost/spoken_quests_dev

# pg_dump 16.10 and later wrap output in \restrict / \unrestrict, psql meta-commands that
# an older psql fails on. Both clusters are ours, so strip them rather than requiring the
# droplet's psql to match this one. Same reasoning as make/zones.mk's UNRESTRICT.
UNRESTRICT := sed -e '/^\\restrict/d' -e '/^\\unrestrict/d'

migrate-books: require-droplet ## Copy the local books corpus onto the droplet (REPLACES book_line)
	@echo "local:"
	@psql "$(LOCAL_DB)" -c 'select count(*) as rows, count(*) filter (where "isCurrent") as live, count(distinct "bookId") as books from "book_line"'
	@echo "droplet:"
	@$(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" 		-c "select count(*) as rows, count(*) filter (where \"isCurrent\") as live, count(distinct \"bookId\") as books from \"book_line\""'
	@printf 'Replace the droplet book_line with the local one? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@( echo 'begin;'; \
	   echo 'truncate "book_line";'; \
	   pg_dump "$(LOCAL_DB)" --data-only --table=book_line | $(UNRESTRICT); \
	   echo 'select setval(pg_get_serial_sequence('"'"'public.book_line'"'"', '"'"'id'"'"'), coalesce(max("id"), 1)) from public."book_line";'; \
	   echo 'commit;' ) \
	  | $(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -q'
	@echo "==> pushed"

# The sequence is reset in the same transaction, because --data-only does not carry it and
# the next edit saved through the site would collide with an id the dump already used.
#
# SCHEMA-QUALIFIED, and that is not style. pg_dump's preamble runs
# `set_config('search_path', '', false)`, so every unqualified name after it fails to
# resolve -- the dump's own statements say public.book_line for exactly this reason. Left
# bare, this line aborts the transaction and rolls the whole load back, while the sequence
# it was fixing keeps its new value, because sequences are not transactional.

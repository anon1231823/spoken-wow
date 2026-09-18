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
        ssh-check store cutover-audio migrate-legacy migrate-legacy-dry migrate-lines \
        migrate-books migrate-reports migrate-verdicts

APP := @spoken/web

# Connect as deploy, never root: pm2 daemons are per-user, so `pm2 reload` over an ssh
# session as root talks to root's empty daemon and silently does nothing.
DROPLET     ?= deploy@188.166.37.175
REMOTE_ROOT := /srv/spoken

# The two trees this one replaces. Read by cutover-audio, and by nothing else.
OLD_QUESTS := /srv/voiceover
OLD_ZONES  := /srv/zonelore

# The block volume the audio actually lives on; shared/ reaches it through symlinks that
# deploy/web/store.sh installs. Named here only so the copy below can refuse to run when
# the volume is missing -- which would otherwise pour 10 GB onto a 12 GB root disk.
STORE := /mnt/voice/spoken

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

store: ## Print the /mnt/voice setup (run it on the droplet as root)
	@cat deploy/web/store.sh

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
	@echo "==> copying ~10 GB onto the /mnt/voice volume; the old trees are left whole"
	$(SSH) $(DROPLET) 'set -eu; \
	  test -f $(STORE)/.store || { echo "the $(STORE) volume is not mounted"; exit 1; }; \
	  cp -an $(OLD_QUESTS)/shared/audio/.           $(REMOTE_ROOT)/shared/audio/; \
	  cp -an $(OLD_QUESTS)/shared/voices/.          $(REMOTE_ROOT)/shared/voices/; \
	  cp -an $(OLD_QUESTS)/shared/audio-previews/.  $(REMOTE_ROOT)/shared/audio-previews/; \
	  cp -an $(OLD_QUESTS)/shared/downloads/.       $(REMOTE_ROOT)/shared/downloads/; \
	  cp -an $(OLD_QUESTS)/shared/audio-history/.   $(REMOTE_ROOT)/shared/audio-history/quests/; \
	  cp -an $(OLD_ZONES)/shared/Sounds/.           $(REMOTE_ROOT)/shared/sounds/; \
	  cp -an $(OLD_ZONES)/shared/audio-history/.    $(REMOTE_ROOT)/shared/audio-history/zones/; \
	  cp -an $(OLD_ZONES)/shared/manifest.json    $(REMOTE_ROOT)/shared/manifest.json; \
	  chown -R deploy:deploy $(STORE) $(REMOTE_ROOT)/shared || true; \
	  du -sh $(STORE)/*; df -h $(STORE) | tail -1'
	@echo "==> copied. The old trees still hold their own copies; delete them only after the rollback window."

# COPIES, never moves, and `cp -an` never overwrites. The old trees are the rollback: if
# spoken.rusty.one has to be stood down, the two old apps start again against audio that
# was never touched. Disk is the cheap half of that trade.

# Both imports run ON THE DROPLET, against the release's own copy of the script: the two
# databases listen on 127.0.0.1 only, and the script resolves `pg` out of the release's
# node_modules. The connection strings are read from the two app.env files there, so no
# password is typed, stored in a shell history, or carried across the wire.
define remote-import
$(SSH) $(DROPLET) 'cd $(REMOTE_ROOT)/current/apps/web && \
  DATABASE_URL=$$(sed -n "s/^DATABASE_URL=//p" $(REMOTE_ROOT)/shared/app.env) \
  ZONELORE_URL=$$(sed -n "s/^DATABASE_URL=//p" $(OLD_ZONES)/shared/app.env) \
  VOICEOVER_URL=$$(sed -n "s/^DATABASE_URL=//p" $(OLD_QUESTS)/shared/app.env) \
  node scripts/migrate-legacy.mjs $(1)'
endef

migrate-lines: ## Copy the zones corpus, flags and takes onto the droplet (rerunnable)
	@$(call remote-import,--lines)

# Lore rows, flags and takes are statements about lines that only lore.rusty.one holds, so
# re-copying them replaces them with themselves and this can be run whenever it is useful.
# Accounts, sealed keys and reports cannot be: accounts merge into rows this database
# already has, and reports are never deduplicated. Those move once, at the cutover, below.

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

migrate-books: ## Copy the local books corpus onto the droplet (REPLACES book_line)
	@echo "local:"
	@psql "$(LOCAL_DB)" -c 'select count(*) as rows, count(*) filter (where "isCurrent") as live, count(distinct "bookId") as books from "book_line"'
	@echo "droplet:"
	@$(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" 		-c "select count(*) as rows, count(*) filter (where \"isCurrent\") as live, count(distinct \"bookId\") as books from \"book_line\""'
	@printf 'Replace the droplet book_line with the local one? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@( echo 'begin;'; 	   echo 'truncate "book_line";'; 	   pg_dump "$(LOCAL_DB)" --data-only --table=book_line | $(UNRESTRICT); 	   echo 'select setval(pg_get_serial_sequence('"'"'book_line'"'"', '"'"'id'"'"'), coalesce(max("id"), 1)) from "book_line";'; 	   echo 'commit;' ) 	  | $(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -q'
	@echo "==> pushed"

# The sequence is reset in the same transaction, because --data-only does not carry it and
# the next edit saved through the site would collide with an id the dump already used.

migrate-reports: ## Copy both sections' reports onto the droplet (rerunnable, pre-cutover)
	@$(call remote-import,--reports)

# Reports move early only because a triage page with nothing in it cannot be looked at.
# They are replaced by source rather than merged, since nothing about a report is unique --
# three people reporting one line is the signal the table exists to carry.

migrate-verdicts: ## Copy the quests triage decisions onto this database's scan (rerunnable)
	@$(call remote-import,--verdicts)

# The findings themselves are a scan's output and are rebuilt here; the verdicts on them
# are not. Matched on (category, item), which is what a finding is.

migrate-legacy-dry: ## Rehearse the full zones import on the droplet (writes nothing)
	@$(call remote-import,--dry-run)

migrate-legacy: ## Import the zones data into the new database (once, at cutover)
	@$(call remote-import)

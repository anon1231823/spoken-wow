# The books pipeline: the vmangos extract, the corpus import, the addon export.
#
#     make books-extract     ->  make -f make/books.mk extract
#
# Its own file because AGENTS.md forbids merging the Makefiles: quests.mk and zones.mk
# already collide on fifteen target names and this one would collide with both.
#
# The MySQL is the quests pipeline's. One vmangos dump on the machine, loaded once and read
# by both extracts -- a second copy is hundreds of megabytes and another thing to keep in
# step with a dump refresh.
#
# The connection is configured through BOOKS_MYSQL_*, not MYSQL_*, for the reason
# tts_cli/env_vars.py loads its .env with override=True: generic names are exported by
# other projects, and an ambient MYSQL_PASSWORD turns this into an access-denied error that
# reads like a missing dump.

.DEFAULT_GOAL := help
.PHONY: help db extract import export lookup deploy deploy-copy status remove \
        pull pull-dry sounds db-pull test

PIPELINE := pipelines/books
QUESTS   := pipelines/quests

help: ## List the books targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sort \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

db: ## Start the vmangos MySQL (the quests pipeline's; loading the dump is its own job)
	@docker compose -f $(QUESTS)/docker-compose.yml up -d mysql

extract: ## vmangos -> pipelines/books/corpus/extract.json
	@node $(PIPELINE)/tools/extract.mjs

import: ## corpus/extract.json -> book_line (needs DATABASE_URL)
	@node $(PIPELINE)/tools/import.mjs

export: ## book_line -> addons/SpokenBooks/Data/Books.lua (needs DATABASE_URL)
	@node $(PIPELINE)/tools/export.mjs

lookup: ## take -> addons/SpokenBooksAudio/Data/Sounds.lua (needs DATABASE_URL)
	@node $(PIPELINE)/tools/build-lookup.mjs

#-------------------------------------------------------------------------------
# The narration
#
# Generation happens on the droplet -- that is where the site runs and where the queue
# spends the credits -- so the masters live there and come here to be packaged and to be
# listened to in a client. Audio is not in git; see the root .gitignore.
#-------------------------------------------------------------------------------

DROPLET     ?= deploy@188.166.37.175
DEPLOY_KEY  ?= ~/.ssh/id_rusty.one
SSH         := ssh -i $(DEPLOY_KEY) -o IdentitiesOnly=yes
REMOTE_BOOKS := /srv/spoken/shared/books/
LOCAL_BOOKS  := pipelines/books/audio/

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# No --delete, unlike the zones targets. Nothing here is irreplaceable in the way a hand
# imported store is -- every clip can be cut again -- but a mirror that silently removes
# local files is still the wrong default for a directory somebody may have pulled a subset
# into. Stale files cost disk; deleted ones cost credits.
RSYNC_OPTS := -az --info=stats1,progress2 --human-readable

LOCAL_DB ?= postgres://localhost/spoken_quests_dev

# pg_dump 16.10 and later wrap their output in \restrict / \unrestrict, psql meta-commands
# an older psql fails on. Both clusters are ours, so strip them. Same as make/zones.mk.
UNRESTRICT := sed -e '/^\\restrict/d' -e '/^\\unrestrict/d'

db-pull: ## Copy the droplet's books takes into the local database (REPLACES them)
	@printf 'Replace the LOCAL books takes with the droplet ones? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@( echo 'begin;'; \
	   echo 'delete from "take" where "source" = '"'"'books'"'"';'; \
	   $(SSH) $(DROPLET) 'set -a; . /srv/spoken/shared/app.env; set +a; pg_dump "$$DATABASE_URL" --data-only --table=take --inserts' \
	     | grep -E "VALUES \([0-9]+, .books.," | $(UNRESTRICT); \
	   echo 'commit;' ) \
	  | psql "$(LOCAL_DB)" -v ON_ERROR_STOP=1 -q
	@psql "$(LOCAL_DB)" -tAc "select count(*) || ' books takes locally' from take where source = 'books'"
	@echo "==> rebuild the pack's table with:  make books-lookup"

# Filtered with grep rather than a WHERE clause because pg_dump has no such option. --inserts
# puts each row on a line of its own, so the section's rows can be selected out of the dump
# without parsing SQL; --rows-per-insert would batch them across lines and cut statements in
# half, and a COPY-format dump could not be filtered at all.
#
# The pattern matches the source column by position -- id, then source -- rather than the
# word appearing anywhere in a row, and spells the quotes as `.` so that no single quote has
# to survive make's expansion and two levels of shell. Written with real quotes it silently
# matched nothing, which looks exactly like a droplet with no takes on it.

pull-dry: ## Preview what `make books-pull` would fetch
	@$(RSYNC) $(RSYNC_OPTS) --dry-run -e "$(SSH)" $(DROPLET):$(REMOTE_BOOKS) $(LOCAL_BOOKS)

pull: ## Fetch the narration from the droplet into pipelines/books/audio
	@mkdir -p $(LOCAL_BOOKS)
	@$(RSYNC) $(RSYNC_OPTS) -e "$(SSH)" $(DROPLET):$(REMOTE_BOOKS) $(LOCAL_BOOKS)
	@echo "==> pulled. Put it where the addon reads it with:  make books-sounds"

# The pack folder the client loads, filled from the store. A copy rather than a symlink to
# the store directory, because the client follows neither into a folder it does not own --
# and the pack is what gets zipped for release.
sounds: ## Copy the narration into addons/SpokenBooksAudio/Sounds
	@mkdir -p addons/SpokenBooksAudio/Sounds
	@$(RSYNC) -a $(LOCAL_BOOKS) addons/SpokenBooksAudio/Sounds/
	@echo "==> $$(find addons/SpokenBooksAudio/Sounds -name '*.mp3' | wc -l | tr -d ' ') mp3 in addons/SpokenBooksAudio/Sounds"

deploy: ## Symlink the addon into a client (CLIENT=era|anniversary|forever)
	@./scripts/books/deploy.sh

deploy-copy: ## Copy the addon into the client instead of symlinking
	@./scripts/books/deploy.sh --copy

status: ## Show what is installed in every client
	@./scripts/books/deploy.sh --status

remove: ## Uninstall the addon from every client
	@./scripts/books/deploy.sh --remove

test: ## The pipeline's unit tests
	@pnpm --filter @spoken/books-pipeline test

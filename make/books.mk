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
        pull pull-dry sounds db-pull package package-audio release-dry release icon test

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

include make/droplet.mk
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

db-pull: require-droplet ## Copy the droplet's books takes into the local database (REPLACES them)
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

pull-dry: require-droplet ## Preview what `make books-pull` would fetch
	@$(RSYNC) $(RSYNC_OPTS) --dry-run -e "$(SSH)" $(DROPLET):$(REMOTE_BOOKS) $(LOCAL_BOOKS)

pull: require-droplet ## Fetch the narration from the droplet into pipelines/books/audio
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

package: ## Zip the addon into dist/ (for a release)
	@./scripts/books/package.sh

# STORED, NOT DEFLATED. The payload is mp3, which is already compressed: deflate spends
# minutes on 450 MB to save well under a percent. -0 makes this a container rather than a
# compressor, which is all it needs to be.
#
# -X drops the extended attributes macOS attaches, so the zip is the same bytes wherever it
# is built.
#
# ZIPPED FROM INSIDE addons/, so the archive's top level is SpokenBooksAudio/ and it
# unpacks straight into a client's AddOns directory. Zipped from the repo root instead it
# carries an addons/ prefix, and unzipping lands it at AddOns/addons/SpokenBooksAudio,
# where the client will never look.
package-audio: ## Zip the sound pack into dist/ (for another machine, or a release)
	@test -d addons/SpokenBooksAudio/Sounds || { echo "no Sounds/ -- run: make books-pull && make books-sounds"; exit 1; }
	@mkdir -p dist
	@version=$$(sed -n 's/^## Version: //p' addons/SpokenBooksAudio/SpokenBooksAudio.toc); \
	 zip_path="$$PWD/dist/SpokenBooksAudio-$$version.zip"; \
	 rm -f "$$zip_path"; \
	 (cd addons && zip -r -0 -q -X "$$zip_path" SpokenBooksAudio \
	   -x '*.DS_Store' '*/.*'); \
	 printf '%s\n' "built dist/SpokenBooksAudio-$$version.zip"; \
	 printf '  %s mp3, %s\n' \
	   "$$(unzip -Z1 "$$zip_path" | grep -c '\.mp3$$')" \
	   "$$(du -h "$$zip_path" | cut -f1)"; \
	 shasum -a 256 "$$zip_path"

# The in-game addon list reads a TGA or BLP, never the PNG or SVG in
# pipelines/books/assets/, so the icon is converted and committed -- an addon must build
# with no ffmpeg on the machine. Borrowed from the zones pipeline rather than copied: the
# script takes a source and a destination and knows nothing about which project it serves.
#
# Both addons carry the same icon: they install as a pair, and two icons would imply they
# are alternatives to each other.
icon: ## Rebuild both addons' AddonIcon.tga from pipelines/books/assets (needs ffmpeg)
	@python3 pipelines/zones/tools/make-icon.py pipelines/books/assets/spoken-books-512.png addons/SpokenBooks/Textures/AddonIcon.tga
	@cp addons/SpokenBooks/Textures/AddonIcon.tga addons/SpokenBooksAudio/Textures/AddonIcon.tga
	@echo "==> copied to addons/SpokenBooksAudio/Textures/AddonIcon.tga"

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

#-------------------------------------------------------------------------------
# The release
#
# Two CurseForge projects, uploaded by scripts/books/release.sh. Both zips have to be built
# first: the release script refuses a target whose zip is missing rather than uploading a
# stale one it found in dist/.
#-------------------------------------------------------------------------------

release-dry: ## Show what `make books-release` would upload to CurseForge
	@./scripts/books/release.sh --dry-run

release: ## Upload the built zips to CurseForge (needs CURSEFORGE_TOKEN)
	@./scripts/books/release.sh

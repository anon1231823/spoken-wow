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
.PHONY: help db extract import export lookup deploy deploy-copy status remove test

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

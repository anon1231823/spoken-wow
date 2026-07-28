# Audio store sync and droplet plumbing for the voiceline explorer.
#
# The audio store (1.1 GB, 9,456 mp3s) is gitignored and never travels through CI - it
# moves between your machine and the droplet with rsync, only when you say so.
#
# Override the target host on the command line or in the environment:
#   make push DROPLET=deploy@203.0.113.10

# Use the IP, not voiceover.rusty.one: if the name ever sits behind Cloudflare it will
# resolve to Cloudflare, which does not proxy SSH.
DROPLET      ?= deploy@REPLACE_WITH_DROPLET_IP
REMOTE_ROOT  := /srv/voiceover
REMOTE_AUDIO := $(REMOTE_ROOT)/shared/audio/
REMOTE_PM2   := pm2

# No -z: mp3 is already compressed, so it is pure CPU for ~0 gain.
# --delete keeps the two stores in exact correspondence, which is what makes the "missing
# audio" badges in the UI trustworthy - see isGap() in web/src/lib/search.ts.
RSYNC_OPTS := -a --delete --partial --human-readable --info=progress2

.DEFAULT_GOAL := help
.PHONY: help push pull push-dry pull-dry audio-status deploy-scripts rollback releases

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- audio store ----------------------------------------------------------------------

push-dry: ## Preview what `make push` would change on the droplet
	@rsync $(RSYNC_OPTS) --dry-run audio/ $(DROPLET):$(REMOTE_AUDIO)

pull-dry: ## Preview what `make pull` would change locally
	@rsync $(RSYNC_OPTS) --dry-run $(DROPLET):$(REMOTE_AUDIO) audio/

push: ## Upload audio/ to the droplet, then reload so the store index is re-read
	@echo "==> dry run (local -> $(DROPLET))"
	@rsync $(RSYNC_OPTS) --dry-run audio/ $(DROPLET):$(REMOTE_AUDIO) | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	rsync $(RSYNC_OPTS) audio/ $(DROPLET):$(REMOTE_AUDIO)
	@# storeIndex() memoises its readdir on globalThis for the process lifetime, so
	@# without this reload new audio stays invisible and deleted audio still reads as
	@# present. See web/src/lib/audio.ts.
	ssh $(DROPLET) '$(REMOTE_PM2) reload voiceover --update-env'
	@echo "==> pushed and reloaded"

pull: ## Download the droplet's audio store into audio/ (DESTRUCTIVE: --delete)
	@echo "==> dry run ($(DROPLET) -> local)"
	@echo "    --delete will REMOVE local files the droplet does not have."
	@rsync $(RSYNC_OPTS) --dry-run $(DROPLET):$(REMOTE_AUDIO) audio/ | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	rsync $(RSYNC_OPTS) $(DROPLET):$(REMOTE_AUDIO) audio/
	@echo "==> pulled"

audio-status: ## Compare file count and size on both sides
	@echo "local:  $$(find audio -name '*.mp3' | wc -l | tr -d ' ') files, $$(du -sh audio | cut -f1)"
	@ssh $(DROPLET) 'echo "remote: $$(find $(REMOTE_AUDIO) -name "*.mp3" | wc -l | tr -d " ") files, $$(du -sh $(REMOTE_AUDIO) | cut -f1)"'

# --- droplet plumbing -----------------------------------------------------------------

deploy-scripts: ## Install deploy/bin + ecosystem.config.js on the droplet
	rsync -a deploy/bin/ $(DROPLET):$(REMOTE_ROOT)/bin/
	rsync -a deploy/ecosystem.config.js $(DROPLET):$(REMOTE_ROOT)/shared/
	ssh $(DROPLET) 'chmod +x $(REMOTE_ROOT)/bin/*.sh'
	@echo "==> installed"

releases: ## List releases on the droplet, marking the live one
	@ssh $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh --list'

rollback: ## Roll back to the previous release (or RELEASE=<name>)
	ssh $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh $(RELEASE)'

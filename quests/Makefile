# Audio store sync and droplet plumbing for the voiceline explorer.
#
# The audio store (1.1 GB, 9,456 mp3s) is gitignored and never travels through CI - it
# moves between your machine and the droplet with rsync, only when you say so.
#
# Override the target host on the command line or in the environment:
#   make push DROPLET=deploy@203.0.113.10

# Connect as deploy, never root: pm2 daemons are per-user, so `pm2 reload` over an ssh
# session as root talks to root's empty daemon and silently does nothing, leaving the
# freshly pushed audio invisible. An IP rather than a hostname keeps this working if the
# name is ever pointed at a CDN, which would not proxy SSH.
DROPLET      ?= deploy@188.166.37.175
REMOTE_ROOT  := /srv/voiceover
REMOTE_AUDIO := $(REMOTE_ROOT)/shared/audio/
REMOTE_VOICES := $(REMOTE_ROOT)/shared/voices/
REMOTE_PM2   := pm2

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# The key CI authenticates with, so `make ssh-check` tests what CI actually does. Every
# droplet target uses it too: the deploy user authorises this key only, and a bare `ssh`
# would offer whatever ~/.ssh/config names instead and be refused.
DEPLOY_KEY ?= ~/.ssh/id_rusty.one
SSH        := ssh -i $(DEPLOY_KEY) -o IdentitiesOnly=yes

# No -z: mp3 is already compressed, so it is pure CPU for ~0 gain.
# --delete keeps the two stores in exact correspondence, which is what makes the "missing
# audio" badges in the UI trustworthy - see isGap() in web/src/lib/search.ts.
RSYNC_OPTS := -a --delete --partial --human-readable --info=progress2 -e "$(SSH)"

# Fail with an explanation rather than an rsync usage dump or a silent no-op reload.
define preflight
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. macOS ships openrsync, which lacks --info."; \
	                        echo "Install one:  brew install rsync"; exit 1; }
	@case "$(DROPLET)" in root@*) \
	  echo "DROPLET is $(DROPLET). Use deploy@ instead: pm2 daemons are per-user, so a"; \
	  echo "reload as root finds no 'voiceover' process and the new audio stays invisible."; \
	  exit 1;; esac
endef

.DEFAULT_GOAL := help
.PHONY: help push pull push-dry pull-dry audio-status pull-voices push-voices voices-status \
        deploy-scripts rollback releases ssh-check

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- audio store ----------------------------------------------------------------------

push-dry: ## Preview what `make push` would change on the droplet
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run audio/ $(DROPLET):$(REMOTE_AUDIO)

pull-dry: ## Preview what `make pull` would change locally
	$(preflight)
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(DROPLET):$(REMOTE_AUDIO) audio/

push: ## Upload audio/ to the droplet, then reload so the store index is re-read
	$(preflight)
	@echo "==> dry run (local -> $(DROPLET))"
	@$(RSYNC) $(RSYNC_OPTS) --dry-run audio/ $(DROPLET):$(REMOTE_AUDIO) | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	$(RSYNC) $(RSYNC_OPTS) audio/ $(DROPLET):$(REMOTE_AUDIO)
	@# storeIndex() memoises its readdir on globalThis for the process lifetime, so
	@# without this reload new audio stays invisible and deleted audio still reads as
	@# present. See web/src/lib/audio.ts.
	$(SSH) $(DROPLET) '$(REMOTE_PM2) reload voiceover --update-env'
	@echo "==> pushed and reloaded"

pull: ## Download the droplet's audio store into audio/ (DESTRUCTIVE: --delete)
	$(preflight)
	@echo "==> dry run ($(DROPLET) -> local)"
	@echo "    --delete will REMOVE local files the droplet does not have."
	@$(RSYNC) $(RSYNC_OPTS) --dry-run $(DROPLET):$(REMOTE_AUDIO) audio/ | tail -20
	@printf 'Proceed? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	$(RSYNC) $(RSYNC_OPTS) $(DROPLET):$(REMOTE_AUDIO) audio/
	@echo "==> pulled"

# --- voice clips ----------------------------------------------------------------------
#
# The clips a voice was cloned from. Small (kilobytes each) but irreplaceable: an ElevenLabs
# voice cannot be exported, so losing these means a voice can never be remade - the exact
# failure that left this project with inherited voices it could not reproduce.
#
# Uploads happen on the droplet through the web UI, so unlike the audio store the droplet is
# usually the newer side. Neither target uses --delete for that reason: these are two
# collections being kept in sync by hand, not a mirror with an authoritative side.

pull-voices: ## Fetch voice clips from the droplet (non-destructive)
	$(preflight)
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		$(DROPLET):$(REMOTE_VOICES) voice/samples/
	@echo "==> pulled into voice/samples/"

push-voices: ## Upload voice clips to the droplet (non-destructive)
	$(preflight)
	@[ -d voice/samples ] || { echo "no voice/samples/ to push"; exit 1; }
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		voice/samples/ $(DROPLET):$(REMOTE_VOICES)
	@echo "==> pushed"

voices-status: ## Compare clip count and size on both sides
	@echo "local:  $$(find voice/samples -type f 2>/dev/null | wc -l | tr -d ' ') clips, $$(du -sh voice/samples 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_VOICES) -type f 2>/dev/null | wc -l | tr -d " ") clips, $$(du -sh $(REMOTE_VOICES) 2>/dev/null | cut -f1)"'

audio-status: ## Compare file count and size on both sides
	@echo "local:  $$(find audio -name '*.mp3' | wc -l | tr -d ' ') files, $$(du -sh audio | cut -f1)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_AUDIO) -name "*.mp3" | wc -l | tr -d " ") files, $$(du -sh $(REMOTE_AUDIO) | cut -f1)"'

# --- droplet plumbing -----------------------------------------------------------------

# `-F /dev/null` is the point of this target, and IdentitiesOnly alone is not enough: a
# `Host *` block in ~/.ssh/config contributes its IdentityFile entries to every host, so
# a plain `ssh -i deploy_key host` can succeed on a personal key and report a working
# deploy key that CI - which has only this one, and no ssh config - cannot use.
ssh-check: ## Test the CI deploy key against the droplet, as CI authenticates
	@echo "local  $(DEPLOY_KEY): $$(ssh-keygen -lf $(DEPLOY_KEY) 2>/dev/null | awk '{print $$2}' || echo 'MISSING')"
	@echo "compare against the 'deploy key fingerprint' line in the workflow log"
	@ssh -F /dev/null -i $(DEPLOY_KEY) -o IdentitiesOnly=yes -o BatchMode=yes $(DROPLET) \
		'echo "connected as $$(whoami)"; ls -ld /srv/voiceover /srv/voiceover/bin 2>&1' \
		|| { echo; echo "Rejected. On the droplet, as root:"; \
		     echo "  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh"; \
		     echo "  echo '<contents of $(DEPLOY_KEY).pub>' >> /home/deploy/.ssh/authorized_keys"; \
		     echo "  chown deploy:deploy /home/deploy/.ssh/authorized_keys"; \
		     echo "  chmod 600 /home/deploy/.ssh/authorized_keys"; exit 1; }

deploy-scripts: ## Install deploy/bin + ecosystem.config.js on the droplet
	$(RSYNC) -a -e "$(SSH)" deploy/bin/ $(DROPLET):$(REMOTE_ROOT)/bin/
	$(RSYNC) -a -e "$(SSH)" deploy/ecosystem.config.js $(DROPLET):$(REMOTE_ROOT)/shared/
	$(SSH) $(DROPLET) 'chmod +x $(REMOTE_ROOT)/bin/*.sh'
	@echo "==> installed"

releases: ## List releases on the droplet, marking the live one
	@$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh --list'

rollback: ## Roll back to the previous release (or RELEASE=<name>)
	$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh $(RELEASE)'

# Deploying the voiceline explorer

The explorer runs at **https://lore.rusty.one** on a DigitalOcean droplet behind nginx,
supervised by pm2, deployed by GitHub Actions on every push to `master` that touches
`web/`, `tools/`, `addon/ZoneLore/Data/` or `deploy/`.

This is the same shape as `../wow-voiceover`, on the same droplet, and deliberately beside
it rather than tangled with it: a separate `/srv` tree, a separate database, a separate pm2
app, and **port 3001**, because voiceover holds 3000. It adds one nginx vhost and one
database; it installs no Node, no pm2 and no firewall rule, and changes no existing site.

**One coupling to know about:** the app runs under the box's system Node, and CI builds
against a pinned major (`node-version` in `deploy-web.yaml`, currently 24). If you upgrade
the system Node for another service, bump that value to match and redeploy.

```
/srv/zonelore/
  shared/
    Sounds/<mapID>/<slug>.mp3   ~700 MB, moved by `make push`, never touched by a deploy
    audio-history/<file>/v<n>.mp3  superseded takes. Loss is permanent - see below.
    manifest.json               exported from the database; `make pull-manifest`
    app.env                     DATABASE_URL, BETTER_AUTH_*, ZONELORE_SECRET_KEY. Mode 600, never in git.
    ecosystem.config.js         pm2 config, outlives every release
  releases/
    20260802-1143-a1b2c3d/      ~62 MB bundle + the lore corpus + migrations
      web/server.js             standalone entrypoint (one level down - see below)
      addon/ZoneLore/Data/<locale>/ the corpus, one directory per language
      tools/voice/config.json   the voice, model and output format
      migrations/
  current -> releases/...       the symlink pm2 follows. Swapping it is the deploy.
  bin/{activate,migrate,rollback,prune}.sh
```

## The one thing that makes this different from a normal Next.js deploy

**Every path under `tools/` is derived from `ROOT` in `tools/lib/loredata.mjs`, and that
derivation does not survive a bundler.**

The explorer imports `tools/voice/*.mjs` directly rather than shelling out to the CLI, so
that there is one generation path and not two — that is the whole argument in
`web/src/lib/tools.ts`, and `next.config.ts` sets `outputFileTracingRoot` to the repo root
to allow it. The consequence is that webpack compiles those modules, and webpack replaces
`import.meta.url` **at build time** with the build machine's own path. A bundle built in CI
carries a literal `file:///home/runner/work/wow-lore/wow-lore/tools/lib/loredata.mjs`, so a
deployed process looks for the lore corpus, the audio store and the manifest inside a
directory that exists only on a GitHub runner, and finds none of them.

So a deployed process is told where its files are. Five environment variables, set in
`ecosystem.config.js`; unset — which is every local run, CLI or `next dev` — each one falls
back to exactly the path it always had, and nothing about working locally changes.

| Env var | Value on the droplet | Why there |
|---|---|---|
| `ZONELORE_ROOT` | `/srv/zonelore/current` | **Per release.** Resolves the lore corpus (`addon/ZoneLore/Data/<locale>/*.lua`), the voice config (`tools/voice/config*.json`) and the spoken-text substitutions (`tools/voice/pronunciation.json`), so a rollback moves code and data together. |
| `ZONELORE_SOUNDS` | `/srv/zonelore/shared/Sounds` | Shared. ~700 MB that a deploy must not copy and `prune.sh` must not delete. |
| `ZONELORE_AUDIO_HISTORY` | `/srv/zonelore/shared/audio-history` | Shared. **Its loss is permanent**: version 1 of each file is the take the corpus was originally cut with, and restoring it is the undo for a re-roll that came out worse. |
| `ZONELORE_MANIFEST` | `/srv/zonelore/shared/manifest.json` | Shared. With `DATABASE_URL` set the database is authoritative and this is a write-only export — the route by which the addon build learns what the droplet generated. |

The split is the same question each time: **does a deploy or a rollback destroy this?** The
corpus should move with the code. The audio, the archive and the two files the app writes
must not.

The `outputFileTracingRoot` setting has a second visible consequence: `standalone` lays the
bundle out from the repo root, so the entrypoint is **`web/server.js`**, not `server.js` at
the top. `ecosystem.config.js` and `activate.sh` both expect that.

## Why the release is assembled by hand in CI

Next traces the files a build imports. It cannot trace a `readFile` of a path computed at
runtime, which is what the corpus, the voice config and the pronunciation rules all are — so
none of them is in the bundle, and the workflow's "Assemble release" step copies each one
explicitly. `activate.sh` checks for all of them before it swaps the symlink, because a
release missing its corpus does not crash: it serves an empty explorer.

## First-time setup

**1. Check the droplet has room.** ~700 MB of audio, plus however much history has
accumulated, plus five ~62 MB releases. RAM is modest — the memoised catalogue is 1353
entries of Lua, not voiceover's 15 MB of JSON — so one pm2 worker at a few hundred MB.

**2. Run the bootstrap**, as root. It uses the Node, pm2 and Postgres already on the box and
installs one thing: ffmpeg, for `ffprobe`.

```bash
make bootstrap
```

That copies `bootstrap.sh` to the droplet and runs it as root, in one step — the two
halves are worth keeping together, because the ssh half on its own reports nothing more
than `No such file or directory`.

It creates the `deploy` user if missing (voiceover already made it), the `/srv/zonelore`
tree, and a `zonelore` role and database on the existing cluster. It prints the generated
password once — you need it for the next step.

**3. Write `shared/app.env`.** The only place the secrets exist; the pm2 config in git reads
them from here.

```bash
cat > /srv/zonelore/shared/app.env <<EOF
DATABASE_URL=postgres://zonelore:<password>@127.0.0.1:5432/zonelore
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=https://lore.rusty.one
ZONELORE_SECRET_KEY=$(openssl rand -base64 32)
EOF
chown deploy:deploy /srv/zonelore/shared/app.env
chmod 600 /srv/zonelore/shared/app.env
```

**Port 5432 here, 5433 in `.env.example`.** The 5433 is a workstation quirk — voiceover's
docker Postgres holds 5432 there. On the droplet the cluster is on its default port.

`BETTER_AUTH_SECRET` signs the session cookies. Rotating it signs everyone out, which is
also the way to revoke every session at once.

**`BETTER_AUTH_URL` is the one worth double-checking.** It must be the public origin
exactly — scheme, host, no trailing slash. Better Auth validates the `Origin` header of
every state-changing request against it, so a stale or mismatched value does not fail
loudly at boot: the site loads, browsing works, and every sign-in, registration and role
change returns `403 Invalid origin`.

**`ELEVENLABS_API_KEY` no longer belongs here.** The site spends each editor's own
credits: a key is set per account on `/profile`, sealed with `ZONELORE_SECRET_KEY` and
stored in the `elevenlabs_key` table. An account without one is refused with `428` and a
dialog saying where to set it, whatever its role. If the variable is still in `app.env`
from an earlier deploy, remove it — nothing in the web app reads it, and leaving a live
key in a file that no longer needs one is a credential lying around.

**`ZONELORE_SECRET_KEY` is the master key for those stored credentials.** 32 bytes of
base64, and the app refuses to seal or open anything without it in production. Rotating
it does not sign anyone out — it makes every stored ElevenLabs key unreadable, and each
editor must paste theirs in again. There is no re-encryption tool; a rotation is a
message to the two or three people who have keys. Kept separate from
`BETTER_AUTH_SECRET` for exactly that reason: rotating the auth secret is routine and
recoverable, and it must not take the credentials with it.

**4. Certificate first, then the vhost** — nginx will not start referencing a certificate
that does not exist yet. Point an `A` record for `lore.rusty.one` at the droplet, then:

```bash
ssh root@rusty.one 'certbot certonly --nginx -d lore.rusty.one'
scp deploy/nginx-lore.conf root@rusty.one:/etc/nginx/sites-available/zonelore
ssh root@rusty.one 'ln -sf /etc/nginx/sites-available/zonelore /etc/nginx/sites-enabled/ \
  && nginx -t && systemctl reload nginx'
```

`certonly`, not `certbot --nginx`: the installer picks the server block *it* thinks matches,
and a wildcard `*.rusty.one` block elsewhere will win — it then writes the certificate into
that block and leaves this vhost with no TLS at all.

**5. Install the deploy scripts and the audio** (~700 MB, so allow time):

```bash
make deploy-scripts
make push
```

**6. Set up GitHub credentials** (below) and run the workflow by hand the first time.

**7. Seed the database.** The first deploy creates the schema and nothing else, so until
this runs the explorer shows 1353 lines with no audio at all:

```bash
make db-push
```

**8. Promote yourself to admin.** Register at `https://lore.rusty.one/register` — which
grants nothing, by design — and then, once, as root:

```bash
su - postgres -c "psql -d zonelore \
  -c \"UPDATE \\\"user\\\" SET role = 'admin' WHERE email = 'you@example.com'\""
```

There is no way to create the first admin through the UI, deliberately: the alternative is
a rule like "the first account registered becomes admin", and on a site that is reachable
from the internet the moment nginx reloads, that is a race anyone can enter. Every
promotion after this one goes through `/admin`.

Sign out and back in is not required — the role is read from the database on each request,
not baked into the session cookie.

## GitHub credentials, step by step

Run everything locally. Four secrets total.

```bash
# 1 - a deploy-only key. No passphrase; Actions cannot type one.
ssh-keygen -t ed25519 -f ~/.ssh/zonelore_deploy -C "gha-zonelore-deploy" -N ""

# 2 - authorize it for the deploy user only
ssh-copy-id -i ~/.ssh/zonelore_deploy.pub deploy@rusty.one
ssh -i ~/.ssh/zonelore_deploy deploy@rusty.one 'echo ok'   # must print: ok

# 3 - capture the host key, so CI verifies the server rather than trusting it blindly
ssh-keyscan -H rusty.one > /tmp/known_hosts

# 4 - set the secrets (from the repo root, with gh authenticated)
gh secret set DO_SSH_KEY     < ~/.ssh/zonelore_deploy
gh secret set DO_KNOWN_HOSTS < /tmp/known_hosts
gh secret set DO_HOST        --body "rusty.one"
gh secret set DO_USER        --body "deploy"

# 5 - verify and clean up
gh secret list
rm /tmp/known_hosts
```

For `DO_SSH_KEY` through the UI instead, paste the **private** key including its
`-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END …-----` lines *and the trailing
newline* — a missing trailing newline is the usual cause of `Load key: error in libcrypto`.
The workflow repairs CRLF and a missing newline, and checks the key parses before it tries
to use it, so that failure at least names itself.

The workflow declares `environment: production`, so create it under **Settings →
Environments**. That also gives you a deployment history and the option of a
required-reviewer gate later without touching the workflow.

If voiceover is already deployed from another repo, these four secret *names* collide with
nothing — secrets are per-repository.

## What a deploy does

1. Typecheck, `tools/validate.mjs`, and migrations against a throwaway Postgres. A red
   build never reaches the droplet.
2. Build, then assemble `standalone` + `.next/static` + the corpus + `tools/voice/*.json` +
   `migrations/` into a release directory.
3. **Boot that exact artifact in CI**, with the same five path overrides pm2 will set, and
   assert the catalogue shipped, the zone filter matches, an admin can quote a
   regeneration and the stylesheet resolves. This is the step that catches a missing copy
   in step 2 — the failure mode is a release that serves an empty explorer rather than one
   that crashes.
4. `rsync` it to `releases/<utc-stamp>-<sha>/`.
5. `activate.sh` — check the release is complete, `migrate.sh`, atomic symlink swap,
   `pm2 startOrReload --update-env`.
6. Smoke check on the droplet; **on failure it rolls back automatically** and fails the job.
7. `prune.sh 5`.

Migrations run **before** the swap, so a migration that fails aborts the deploy with the
previous release still serving. Each file is applied once, inside a transaction that also
records its name in `schema_migration`.

The asymmetry worth holding in your head: **a rollback moves code, never schema.** Nothing
un-applies a migration, so migrations have to stay additive — a release must be able to run
against the schema of the release *after* it. Adding a nullable column is fine; renaming or
dropping one needs two deploys.

## Getting work off the droplet and into the addon

Regeneration happens on the droplet now, which makes it the newer side. Nothing there
builds the addon, so a release goes:

```bash
make pull            # the audio the droplet regenerated (--delete: read the dry run)
make db-pull         # the takes and flags behind it
make lookup          # rebuild Sounds.lua from the manifest
make validate-audio  # manifest, files on disk and lookup table agree
git diff             # manifest.json is the reviewable part
```

`addon/ZoneLoreAudio/Data/Sounds.lua` *is* regenerated on the droplet after each
regeneration, inside the release directory, where nothing reads it and `prune.sh` will
eventually delete it. That is fine — it is derived from the manifest, and `make lookup`
above is the copy that matters.

## Operating it

```bash
make ssh-check                     # is the droplet reachable and set up
make releases                      # list, marking the live one
make rollback                      # one release older
make rollback RELEASE=20260802-1143-a1b2c3d
make audio-status                  # store parity between local and droplet
make logs                          # pm2 logs zonelore
ssh deploy@rusty.one 'pm2 status'
```

Rollback walks strictly backwards in time, so running it repeatedly keeps stepping to older
releases instead of bouncing between the newest two.

## Gotchas worth knowing

- **The site is public to read and closed to write.** Anyone may browse, filter and listen;
  that is the point of hosting it. Everything that costs money or changes shared state —
  Regenerate, Restore, the review flags, the pronunciation rules, `/admin` — needs a role,
  and registering grants none. See `web/src/lib/permissions.ts` for the three, and
  `web/src/lib/authz.ts` for where each one is actually enforced. The role checks in the
  components decide what to draw and nothing more.
- **`nginx-lore.conf` still carries a commented-out basic-auth block** in all three
  location blocks. It predates the accounts and is now a blunt instrument for taking the
  whole site private — a maintenance window, say — rather than the access control it was
  standing in for. `htpasswd -c /etc/nginx/.htpasswd-zonelore <you>` to use it.
- **The hardest possible stop on spending is now per person.** Clearing someone's key on
  `/admin` closes the expensive path for that account without touching their role;
  clearing every key closes it site-wide, admins included. There is no server-wide key
  left to withhold.
- **One pm2 worker, deliberately.** Regeneration batches are in-process state on
  `globalThis`, not queue tables, so a second worker would answer "no such batch" to half
  the progress polls. The cost is a brief blip on each deploy rather than a rolling reload.
- **A deploy kills a running batch.** The batch is in-process, so `pm2 reload` ends it;
  `kill_timeout` is 30s so calls already in flight can return and be recorded rather than
  being billed for audio that never reaches a take row. Do not deploy mid-batch.
- **`make push` propagates local deletions.** The droplet is a second copy of the audio, not
  a backup, and it is usually the *newer* side. `make pull` first if in doubt; both targets
  show a dry run and ask before doing anything.
- **`audio-history/` is the one directory whose loss is permanent.** Version 1 of each file
  is the take the corpus was originally cut with. `make pull` brings it back too.
- **`cp -a`, never `cp -r`, when assembling a release.** pnpm's `node_modules/next` is a
  symlink into `.pnpm/`; a dereferencing copy (which is what BSD `cp -r` does) detaches it
  from its siblings and the bundle dies at boot with
  `Cannot find module 'styled-jsx/package.json'`. The workflow asserts the symlink survived.
- **`pm2 save` runs on every activate**, which is what lets pm2's systemd unit resurrect the
  app after a reboot. Nothing is saved until the first successful deploy.

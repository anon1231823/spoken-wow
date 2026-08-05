# Deploying the voiceline explorer

The explorer runs on a DigitalOcean droplet behind nginx, supervised by pm2, deployed by
GitHub Actions on every push to `master`.

**This is designed to share a droplet with your existing services.** Setup adds a new nginx
vhost, a new user, and a directory tree — that is all. It installs no Node, no pm2, no
firewall rule and no changes to any existing site; it uses what the box already has.

pm2 daemons are per-user, so the `deploy` user gets its own `~/.pm2` and its own daemon:
sharing the pm2 binary does not put this app in the same process namespace as anything
else you run under it.

**One coupling to know about:** the app runs under the box's system Node, and CI builds
against a pinned major (`node-version` in `deploy-web.yaml`, currently 24). If you upgrade
the system Node for another service, bump that value to match and redeploy.

```
/srv/voiceover/
  shared/
    audio/{quests,gossip}/     1.1 GB, moved by `make push`, never touched by a deploy
    audio-history/<sub>/<file>/  previous takes, `make pull-history`. v0 is unreproducible.
    voices/<race-gender>/      clips a voice clone was built from, `make pull-voices`
    ecosystem.config.js        pm2 config, outlives every release
    app.env                    DB URL, session secret, ElevenLabs key. Mode 600, never in git.
  releases/
    20260727-2143-a1b2c3d/     ~62 MB standalone bundle + its corpus and migrations.
  current -> releases/...      the symlink pm2 follows. Swapping it is the deploy.
  bin/{activate,migrate,rollback,prune}.sh
```

Why this shape:

- **Releases are directories, `current` is a symlink.** Rollback is a rename, so it works
  when CI is down, GitHub is down, or the network is. `make releases` is the version list.
- **Audio lives in `shared/`.** 1.1 GB is never copied on deploy and never rolls back with
  a bad release. Deploys stay ~62 MB and quick.
- **Voice clips live in `shared/` too.** An ElevenLabs voice cannot be exported, so the clips
  it was cloned from are the only way to remake it. They are uploaded on the droplet through
  the web UI, which makes the droplet the *newer* side — `make pull-voices` before you rely
  on the local copy.
- **CI builds, the droplet only runs.** The droplet has no repo, no pnpm and no build
  toolchain; it receives a Next.js `standalone` bundle with its traced `node_modules`.
- **One exception to "installs nothing": ffmpeg.** Merging short clips into one take is a
  server-side operation, so the box needs `ffmpeg` on PATH. Uploading and cloning work
  without it; only merging fails, and it says so.
- **The corpus ships inside each release**, so a rollback moves code and data together.
- **Postgres holds accounts, sessions and roles, and nothing else.** It is not in the read
  path for the corpus or the audio store, so a database outage leaves the explorer working
  for signed-out visitors.

## Runtime paths

The app reads three things from disk. In production all come from env vars set in
`ecosystem.config.js`, because `process.cwd()/..` is a release directory, not the repo:

| Env var | Value | Notes |
|---|---|---|
| `VOICEOVER_AUDIO` | `/srv/voiceover/shared/audio` | shared across releases |
| `VOICEOVER_CORPUS` | `/srv/voiceover/current/corpus/corpus.json.gz` | per release |
| `VOICEOVER_VOICE_SAMPLES` | `/srv/voiceover/shared/voices` | shared; **must be set**, or clips land beside the releases where nothing backs them up |
| `VOICEOVER_AUDIO_HISTORY` | `/srv/voiceover/shared/audio-history` | shared; **must be set**. Version 0 of each file is audio nothing can reproduce |
| `VOICEOVER_VOICE_CONFIG` | `/srv/voiceover/current/voice` | per release; **must be set**, or no pronunciation rules apply, "Hm" is read as the letters H and M, and the lexicon editor shows no rows |
| `VOICEOVER_PREVIEWS` | `/srv/voiceover/shared/audio-previews` | shared; **must be set**, or previews land inside `releases/`, where `prune.sh` counts them as a release and eventually deletes them |

All five exist as overrides in `web/src/lib/paths.ts` — no app code changed for this.

Five more come from `shared/app.env`, which `ecosystem.config.js` parses and merges into
the pm2 environment. They are secrets, and that file is the only place they exist:

| Env var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://voiceover:…@127.0.0.1:5432/voiceover` | localhost only |
| `BETTER_AUTH_SECRET` | 32 random bytes | signs session cookies; rotating it signs everyone out |
| `BETTER_AUTH_URL` | `https://voiceover.rusty.one` | **must match the public origin exactly** |
| `ELEVENLABS_API_KEY` | `sk_…` | reads the voice roster, creates clones, and generates every voiceline. `/voices` reports the failure and still renders without it; Regenerate is refused with the reason |
| `ELEVENLABS_DICTIONARY_ID` | `Elx0…` | the pronunciation dictionary `/lexicon` updates in place. Shared with wow-lore, which names the same id, so **it must not change**: unset, every save creates a new dictionary and that project stays on an old one |

`BETTER_AUTH_URL` is the one worth double-checking. Better Auth validates the `Origin`
header of every state-changing request against it, so a stale or mismatched value does not
fail loudly at boot — the site loads fine and every sign-in, registration and role change
returns `403 Invalid origin`.

## First-time setup

**1. Check the droplet has room.** The app needs **~400 MB of free RAM**: the memory driver
is the memoised corpus parse, measured at ~193 MB RSS per pm2 worker after broad searches,
and the config runs two workers so reloads are zero-downtime. On a droplet already running
other services, check `free -m` first — and if it is tight, drop to `instances: 1` in
`ecosystem.config.js` (~193 MB, at the cost of a brief blip on each deploy) before sizing
the droplet up. Disk: 1.1 GB of audio plus five ~62 MB releases, so ~1.5 GB.

**2. Prepare the droplet**, as root. This uses the Node and pm2 the box already has —
`next@15` needs Node >= 20 — and installs one thing: ffmpeg, which merges voice clips.

```bash
node -v && pm2 -v && command -v rsync      # prerequisites; install rsync if missing
apt-get install -y ffmpeg                  # merging clips; upload and cloning work without it

useradd --create-home --shell /bin/bash deploy
mkdir -p /srv/voiceover/{releases,bin,shared/voices,shared/audio-history,shared/audio/{quests,gossip}}
chown -R deploy:deploy /srv/voiceover

# Per-user boot unit: resurrects only what the deploy user has `pm2 save`d, leaving any
# pm2 setup you already have for another user alone.
pm2 startup systemd -u deploy --hp /home/deploy
```

The `deploy` user owns everything under `/srv/voiceover`, so no part of a deploy or an
audio sync needs sudo.

**2b. Install Postgres and create the app's database**, as root. If the box already runs
Postgres, skip the install and use the cluster it has — this needs one role and one
database, nothing global.

```bash
apt-get install -y postgresql          # skip if the box already has one

# A password no human types, so make it long and paste it into app.env below.
PGPW=$(openssl rand -base64 24)
su - postgres -c "psql -v ON_ERROR_STOP=1 \
  -c \"CREATE ROLE voiceover LOGIN PASSWORD '$PGPW'\" \
  -c 'CREATE DATABASE voiceover OWNER voiceover'"
echo "password: $PGPW"
```

Leave `listen_addresses` at its default of `localhost`. Nothing off the box needs to reach
this database — not even CI, which builds against a throwaway Postgres of its own.

**2c. Write `shared/app.env`.** This is the only place the secrets exist; the pm2 config in
git reads them from here.

```bash
cat > /srv/voiceover/shared/app.env <<EOF
DATABASE_URL=postgres://voiceover:$PGPW@127.0.0.1:5432/voiceover
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=https://voiceover.rusty.one
ELEVENLABS_API_KEY=sk_your_key_here
EOF
chown deploy:deploy /srv/voiceover/shared/app.env
chmod 600 /srv/voiceover/shared/app.env
```

`BETTER_AUTH_URL` must be the public origin, exactly — scheme, host, no trailing slash.
See the runtime-paths table above for what goes wrong when it is not.

**3. Install the nginx vhost.** Adds a file next to your existing sites; touches none of
them.

```bash
scp deploy/nginx-voiceover.conf root@<ip>:/etc/nginx/sites-available/voiceover
ssh root@<ip> 'ln -sf /etc/nginx/sites-available/voiceover /etc/nginx/sites-enabled/ \
  && nginx -t && systemctl reload nginx'
```

`nginx -t` before the reload is the safety net — a bad config fails the test rather than
taking your other sites down with it.

**4. Point DNS and get a certificate.** An `A` record for `voiceover.rusty.one` at the
droplet's IP, then:

```bash
ssh root@<ip> 'certbot --nginx -d voiceover.rusty.one'
```

certbot rewrites the vhost in place, adding the `:443` server block and a redirect. Confirm
80/443 are already open in whatever firewall you run — nothing in this setup touches it.

**5. Set `DROPLET` in the `Makefile`** to `deploy@<ip>`. Use the **IP, not the hostname** —
if the name ever sits behind Cloudflare it resolves to Cloudflare, which does not proxy SSH.

**6. Install the deploy scripts and the audio store** (the upload is 1.1 GB, so allow time):

```bash
make deploy-scripts
make push
```

**7. Set up GitHub credentials** (below), then trigger the workflow manually the first time.

## GitHub credentials, step by step

Run everything locally. Four secrets total.

**1 — Generate a deploy-only SSH key.** No passphrase; Actions cannot type one.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/voiceover_deploy -C "gha-voiceover-deploy" -N ""
```

**2 — Authorize it on the droplet**, for the `deploy` user only:

```bash
ssh-copy-id -i ~/.ssh/voiceover_deploy.pub deploy@<ip>
ssh -i ~/.ssh/voiceover_deploy deploy@<ip> 'echo ok'    # must print: ok
```

**3 — Capture the host key**, so CI verifies the server rather than blindly trusting it:

```bash
ssh-keyscan -H <ip> > /tmp/known_hosts
```

**4 — Set the secrets** (from the repo root, with `gh` authenticated):

```bash
gh secret set DO_SSH_KEY     < ~/.ssh/voiceover_deploy
gh secret set DO_KNOWN_HOSTS < /tmp/known_hosts
gh secret set DO_HOST        --body "<ip>"
gh secret set DO_USER        --body "deploy"
```

Through the UI instead: **Settings → Secrets and variables → Actions → New repository
secret**. For `DO_SSH_KEY` paste the **private** key including the
`-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END …-----` lines *and the trailing
newline* — a missing trailing newline is the usual cause of `Load key: error in libcrypto`.

**5 — Verify and clean up:**

```bash
gh secret list        # DO_HOST, DO_KNOWN_HOSTS, DO_SSH_KEY, DO_USER
rm /tmp/known_hosts
```

**6 — Create the `production` environment.** The workflow declares
`environment: production`, so create it under **Settings → Environments** (secrets can live
there instead of at repo level). This also gives you a deployment history and the option of
a required-reviewer gate later without touching the workflow.

**7 — First run:** trigger **Actions → Deploy web → Run workflow** by hand, so the first
deploy is watched rather than incidental.

The private key never leaves your machine except into GitHub's secret store, and authorizes
exactly one unprivileged user on one host. Revoking it is one line out of
`/home/deploy/.ssh/authorized_keys`.

## What a deploy does

1. Typecheck, unit tests, migrations against a throwaway Postgres, build. A red build never
   reaches the droplet.
2. Assemble `standalone` + `.next/static` + `corpus.json.gz` + `migrations/` into a release
   directory.
3. **Boot that exact artifact in CI** and hit `/api/search`, the stylesheet, and a real
   sign-up. This catches a broken bundle before it can replace a working release.
4. `rsync` it to `releases/<utc-stamp>-<sha>/`.
5. `activate.sh` — `migrate.sh`, then the atomic symlink swap, then
   `pm2 startOrReload --update-env`.
6. Smoke check on the droplet; **on failure it rolls back automatically** and fails the job.
7. `prune.sh 5`.

### About step 5

Migrations run **before** the swap, so a migration that fails aborts the deploy with the
previous release still live and serving. Each file in `migrations/` is applied once, inside
a transaction that also records its name in `schema_migrations`; there is no half-applied
state to clean up.

The asymmetry worth holding in your head: **a rollback moves code, never schema.** Nothing
un-applies a migration. So migrations have to stay additive — a release must be able to run
against the schema of the release *after* it, or rolling back one version breaks the site in
a way `rollback.sh` cannot fix. Adding a nullable column is fine; renaming or dropping one
needs two deploys.

### Promoting the first admin

There is deliberately no bootstrap path through the UI. Register normally, then, on the
droplet:

```bash
ssh deploy@<ip>
psql "$(grep ^DATABASE_URL /srv/voiceover/shared/app.env | cut -d= -f2-)" \
  -c "UPDATE \"user\" SET role = 'admin' WHERE email = 'you@example.com'"
```

`user` is quoted because it is a reserved word — that is Better Auth's default table name.
Every role after this one is handed out from `/admin`, which will not let an admin demote
themselves.

## Operating it

```bash
make releases                      # list, marking the live one
make rollback                      # one release older
make rollback RELEASE=20260727-2143-a1b2c3d
make audio-status                  # store parity between local and droplet
ssh deploy@<ip> 'pm2 status'
ssh deploy@<ip> 'pm2 logs voiceover --lines 100'
```

Rollback walks strictly backwards in time, so running it repeatedly keeps stepping to older
releases instead of bouncing between the newest two.

## The regeneration queue

Mass regeneration is a queue in Postgres (`regeneration_batch`, `regeneration_job`), drained
inside the app processes rather than by a separate service. A session-scoped advisory lock picks one
process to lead, and only that one claims jobs. A process joins leader contention the first time
one of the `/api/regenerate/queue` routes is called on it — not on boot, but lazily.

**Two things worth knowing:**

- **`kill_timeout` is load-bearing.** The leader finishes its in-flight ElevenLabs calls
  before releasing the lock, so a `pm2 reload` hands the queue over rather than running two
  drains at once. Lowering it back towards pm2's 1600 ms default reintroduces SIGKILL
  mid-take, and a killed leader's jobs then wait out a five-minute lease.
- **Anything with the database URL is a potential contender.** A one-off `next start` pointed
  at production Postgres becomes one as soon as anything calls a queue route on it — which for
  a `next start` someone is poking at is likely to be the explorer page's own poll. The
  advisory lock is what makes this safe — one leader, whichever it is — but nothing confines
  the queue to the droplet except custody of the database URL.

To see what it is doing without the UI:

```sql
select "state", count(*) from "regeneration_job" group by "state";
select * from "regeneration_batch" order by "createdAt" desc limit 5;
```

To stop it, use `POST /api/regenerate/queue/stop`, which the Stop button calls: it cancels
pending jobs, leaves in-flight ones to finish and be billed, and stamps the batch so the
panel can explain why it stopped.

If the app is not answering, break glass with:

```sql
update "regeneration_job" set "state" = 'cancelled', "finishedAt" = now()
 where "state" = 'pending';
```

This cancels pending jobs but does not stamp the batch with a reason, so the UI will show a
stopped queue with no explanation — and running jobs are unaffected, because their characters
are already billed at ElevenLabs. The full behaviour of `cancelPending()` in
`web/src/lib/generation/queue.ts` is the authority; keep it in sync with changes there.

### Why the queue starts lazily

The queue is started by `ensureQueueRunning()` from `web/src/lib/generation/boot.ts`, called
by the `/api/regenerate/queue` routes, rather than from a Next `instrumentation.ts` hook.

`instrumentation.ts` is the natural home and was the original design. It does not work here:
Next compiles that file for the edge runtime as well as node, whether or not the app has any
edge code, and the `NEXT_RUNTIME` guard stops the code running there but not being bundled.
Webpack then has to resolve the whole server graph — `pg`'s optional native binding, `fs`,
`path`, `stream`, and our own `history.ts` reaching `node:crypto` — for a runtime that never
executes it, and `next dev` answers 500. No `next.config.ts` setting fixes it; the problem is
that the compile happens at all. `next build` is unaffected, because it only produces an edge
compile when the app really contains edge code.

**The cost:** a batch interrupted by a deploy does not resume on boot. It resumes when
something calls a queue route — in practice when an admin opens the explorer, since the page
polls the queue every fifteen seconds for anyone who can regenerate. On a quiet evening an
interrupted batch waits.

**Two ways back to boot-time resume, if that cost stops being acceptable:**

1. **Run `next dev --turbopack`** and restore `instrumentation.ts`. Turbopack compiles it
   without complaint, with no config changes, and the shipped artifact still comes from
   `next build` under webpack. Verified working. The cost is that dev and production then use
   different bundlers, so a server module leaking into the client bundle could pass `pnpm dev`
   and fail `pnpm build` — run the build before trusting a change.
2. **Give the queue its own pm2 process.** Sidesteps Next's bundler entirely. The cost is a
   second build pipeline (CI ships a Next `standalone` bundle with no second entrypoint, and
   the droplet has no toolchain), another ~200 MB for a second corpus heap, five
   `VOICEOVER_*` paths to keep in sync, and a cache-coherence bug that does not exist today:
   `generationStatus` memoises the voice map per process and `/voices` busts it in-process, so
   a separate worker would keep failing lines with "no voice named X" for up to a minute after
   one is created.

## Gotchas worth knowing

- **`make push` refuses to overwrite newer droplet audio.** Regeneration happens on the
  droplet through the web UI, so it is usually the newer side — and `--delete` would take the
  difference with it. Two rsync dry runs, one with `-u`, name exactly the files the droplet
  has changed since you last pulled. `make pull` first, or `FORCE=1` to overwrite anyway.
- **`make push` no longer reloads pm2.** It had to while `storeIndex()` memoised its
  `readdir` forever; it now re-reads whenever either subfolder's mtime moves, which is also
  what lets a line regenerated by one pm2 worker be visible to the other.
- **`audio-history/` is the one directory whose loss is permanent.** Version 0 of each file
  is audio that predates this project's ability to reproduce it — the same failure that left
  this project with voices it could not remake. `make pull-history` it somewhere safe.
- **`cp -a`, never `cp -r`, when assembling a release.** pnpm's `node_modules/next` is a
  symlink into `.pnpm/`; a dereferencing copy (which is what BSD `cp -r` does) detaches it
  from its siblings and the bundle dies at boot with
  `Cannot find module 'styled-jsx/package.json'`.
- **The droplet is a second copy of the audio, not a backup.** `make push` propagates local
  deletions within seconds. Keep the real backup wherever it is today.
- **`pm2 save` runs on every activate**, which is what lets pm2's systemd unit resurrect the
  app after a reboot. Nothing is saved until the first successful deploy.

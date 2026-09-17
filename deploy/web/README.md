# Deploying Spoken

One site, two sections, on the droplet that currently runs the two it replaces. nginx in
front, pm2 supervising, GitHub Actions deploying on every push to `main` that touches
`apps/web/`, `pipelines/`, `addons/SpokenZones/Data/` or `deploy/web/`.

It is deliberately beside the two old trees rather than on top of them: a separate `/srv`
tree, a separate database, a separate pm2 app. `/srv/voiceover` and `/srv/zonelore` are
frozen — see the banner in each of their READMEs — and stay whole after the cutover, because
they are the rollback.

```
/srv/spoken/
  releases/<utc>-<sha>/   one per deploy; prune.sh keeps five
  current -> releases/…   the symlink activate.sh swaps, atomically
  bin/                    activate, migrate, rollback, prune
  shared/                 everything the app writes, and nothing a release owns
    app.env               secrets, mode 600                    on root
    ecosystem.config.js   pm2's config, `make web-deploy-scripts`  on root
    manifest.json         the zones manifest, rewritten on drain   on root
    audio/          -> the quests store              ~3.1 GB  \
    sounds/         -> the zones masters             ~453 MB   |
    audio-history/  -> superseded takes, quests/ and zones/     > symlinks to
    voices/         -> clone clips                              |  /mnt/voice
    audio-previews/ -> rendered pronunciation previews          |
    downloads/      -> the complete sound pack, served off disk /

/mnt/voice/spoken/        a 30 GB block volume; `deploy/web/store.sh` sets it up
  .store                  marker: present only while the volume is mounted
  audio/ sounds/ audio-history/{quests,zones}/ voices/ audio-previews/ downloads/
```

Everything under `shared/` is there for one reason: a release directory is deleted five
deploys later, and every one of those is either irreplaceable or was paid for.

## The audio volume

The stores total ~10 GB, and the merge **copies** them rather than moving them, because the
two old trees are the rollback. The droplet's root filesystem is 33 GB with the old sites
already on it, which leaves no room to do that and no room to grow afterwards. So the bytes
live on `/mnt/voice`, a block volume that can be resized without touching the droplet.

`shared/<store>` reaches it through a symlink, so that name still means what it meant:
`ecosystem.config.js` builds every path variable from it, `make/quests.mk` and
`make/zones.mk` rsync into it, nginx aliases `/downloads/` at it. One path to reason about,
and the disk it sits on is an implementation detail.

```bash
ssh root@rusty.one
  bash store.sh          # make web-store prints it; idempotent
```

It refuses to link a directory that holds files, and it refuses to run at all when
`/mnt/voice` is not a mount point — because `/etc/fstab` mounts it `nofail`, so a droplet
that reboots without the volume comes up happily with `/mnt/voice` an ordinary empty
directory on root. The `.store` marker exists for the same reason from the other side:
`bin/activate.sh` will not deploy without it, which turns a missing volume into a deploy
that stops rather than a site that answers 404 for every line.

`manifest.json` is deliberately **not** on the volume. It is written write-temp-then-rename,
and a rename over a symlink replaces the symlink with a real file. It is 384 KB and the
`take` table rebuilds it.

## Runtime configuration

The app reads its data through environment variables, all set in `shared/ecosystem.config.js`.
They are prefixed by section, and the prefix is not cosmetic — a variable named for a tree it
no longer lives in is one somebody sets on the wrong box.

| Env var | Points at | Lives |
|---|---|---|
| `SPOKEN_QUESTS_CORPUS` | `current/pipelines/quests/corpus/corpus.json.gz` | per release |
| `SPOKEN_QUESTS_VOICE_CONFIG` | `current/pipelines/quests/voice` | per release |
| `SPOKEN_QUESTS_AUDIO` | `shared/audio` | shared; a symlink onto `/mnt/voice` |
| `SPOKEN_QUESTS_AUDIO_HISTORY` | `shared/audio-history/quests` | shared; **must be set**, or version 0 of each file — audio nothing can reproduce — lands in a release |
| `SPOKEN_QUESTS_VOICE_SAMPLES` | `shared/voices` | shared; **must be set**, or clone clips land where nothing backs them up |
| `SPOKEN_QUESTS_PREVIEWS` | `shared/audio-previews` | shared; **must be set**, or previews land inside `releases/`, where `prune.sh` counts them as a release and eventually deletes them |
| `SPOKEN_ZONES_ROOT` | `current` | per release; the zones pipeline resolves its own paths from it |
| `SPOKEN_ZONES_SOUNDS` | `shared/sounds` | shared |
| `SPOKEN_ZONES_AUDIO_HISTORY` | `shared/audio-history/zones` | shared |
| `SPOKEN_ZONES_MANIFEST` | `shared/manifest.json` | shared; the app rewrites it whenever a batch drains |

Five more come from `shared/app.env`, which `ecosystem.config.js` parses and merges into the
pm2 environment. They are secrets, and that file is the only place they exist:

| Env var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://spoken:…@127.0.0.1:5432/spoken` | localhost only |
| `BETTER_AUTH_SECRET` | 32 random bytes | signs session cookies; rotating it signs everyone out |
| `BETTER_AUTH_URL` | `https://spoken.rusty.one` | **must match the public origin exactly** |
| `SPOKEN_SECRET_KEY` | 32 bytes, base64 | the master key stored ElevenLabs credentials are sealed under |
| `ELEVENLABS_DICTIONARY_ID` | `Elx0…` | the pronunciation dictionary `/lexicon` updates in place. **Must not change**: unset, every save creates a new one |

**`SPOKEN_SECRET_KEY` must be the value of `ZONELORE_SECRET_KEY` in
`/srv/zonelore/shared/app.env`.** The zones site's stored keys are sealed under that one and
are imported at cutover as ciphertext; AES-GCM offers no way to re-seal a credential nothing
can open. Get it wrong and every collaborator pastes their key again — recoverable, but they
have to be told.

**There is no `ELEVENLABS_API_KEY`.** Every request that reaches ElevenLabs is spent from the
signed-in user's own account, using a key they set on `/profile`, sealed under
`SPOKEN_SECRET_KEY`. A route asked to spend without one answers `428 no_api_key`. The Python
CLI still reads `pipelines/quests/.env`, because it is run by one person on their own machine.

`BETTER_AUTH_URL` is the one worth double-checking. Better Auth validates the `Origin` header
of every state-changing request against it, so a stale value does not fail at boot — the site
loads fine and every sign-in, registration and role change returns `403 Invalid origin`.

```bash
cat > /srv/spoken/shared/app.env <<EOF
DATABASE_URL=postgres://spoken:$PGPW@127.0.0.1:5432/spoken
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=https://spoken.rusty.one
SPOKEN_SECRET_KEY=$(grep ZONELORE_SECRET_KEY /srv/zonelore/shared/app.env | cut -d= -f2-)
ELEVENLABS_DICTIONARY_ID=Elx0hcDze8EXW2rImeLT
EOF
chown deploy:deploy /srv/spoken/shared/app.env
chmod 600 /srv/spoken/shared/app.env
```

## Standing it up beside the old sites

`deploy/web/bootstrap.sh`, run on the droplet as root, makes the tree and the database and
prints what is left. Then, from a workstation, `make web-deploy-scripts`.

**Stage on port 3002 until the cutover.** Port 3000 belongs to voiceover until it is stopped.

The port goes in `shared/app.env`, not in `ecosystem.config.js`: that file spreads
`readSecrets()` last, so `PORT=3002` in app.env overrides the literal above it. A staging
port is a fact about one box, which is exactly what app.env is for — and it means the
cutover deletes a line rather than reverting a commit.

Either reach it over an ssh tunnel:

```bash
ssh -L 3002:127.0.0.1:3002 deploy@rusty.one     # then http://127.0.0.1:3002
```

…or install the vhost early, pointed at the staging port. `nginx-spoken.conf` names the
upstream once for exactly this:

```nginx
upstream spoken_app {
    server 127.0.0.1:3002;    # 3000 at cutover
```

The second way gets the real certificate and a real origin, so sign-in works — but it also
makes a half-migrated site publicly reachable, with every quest line showing as a gap. Whichever you pick, `BETTER_AUTH_URL` must match the origin you actually
use, or every sign-in returns `403 Invalid origin`: `http://127.0.0.1:3002` for the tunnel,
`https://spoken.rusty.one` for the vhost.

**The zones line data can be staged early**, and should be. Without the corpus `/zones`
renders a "not loaded yet" notice and the search API answers `503 corpus_empty`; without
the takes every line reports missing audio, because presence is read from the `take` table
while the files themselves are already on disk. Quests does not have that second problem —
it reads its store from disk — which is why a half-staged site looks lopsided.

```bash
DATABASE_URL=postgres://spoken:…@127.0.0.1:5432/spoken \
ZONELORE_URL=postgres://zonelore:…@127.0.0.1:5432/zonelore \
  make web-migrate-lines      # lore_line, line_flag, take; writes no migration marker
```

The reports can move early too, for the same reason - a triage page with nothing in it
cannot be looked at - and need the quests database as well as the zones one:

```bash
make web-migrate-reports    # line_report and feedback into report; replaces by source
make web-migrate-verdicts   # the quests triage decisions, onto this database's own scan
```

`line_issue` is rebuilt wholesale by every scan, so a staged database has its own findings
with every verdict back at `open`. The scan is a machine's output and costs nothing to
redo; the verdicts are the part somebody sat down and made, and they are matched across on
`(category, item)` — which the table declares unique, and which is what a finding is.

None of this reaches what only the restore carries: the line overrides, the voice clones,
the quests takes and their history, and the lexicon as it actually stands. Those arrive
with the `pg_dump` at step 3 below, which is the one description of that copy there should
be.

The split is which rows can be thrown away and written again. Those three are statements
about a zone line that lore.rusty.one holds the only copy of, so the import deletes and
re-copies each wholesale and can be run as often as it is useful. Accounts and sealed keys cannot be treated that way — they
merge into rows this database already has — so they move exactly once, at the cutover, by
the import below, which refuses to run a second time. Reports are replaceable only because
the copy deletes this database's reports for that source first: nothing about a report is
unique, and three people reporting one line is the signal the table exists to carry, so a
second copy that merged would double every row.

**Do not regenerate anything on the staged site.** It writes into `shared/`, which at that
point is a copy that the cutover is about to overwrite, and the credits would be spent on a
take that is then thrown away.

## The cutover

A short freeze. Everything before this point is reversible by doing nothing.

```bash
# 1. Stop both old apps. This also stops their queues, and frees port 3000.
ssh deploy@rusty.one 'pm2 stop voiceover zonelore'

# 2. Top up the audio. `cp -an` never overwrites, so if the bulk was copied early (below)
#    this only carries across what was generated since. Copies, never moves: the old
#    trees are the rollback. It refuses to run if the volume is not mounted.
make web-cutover-audio

# 3. The database. The quests half is restored wholesale, because the merged schema was
#    grown from it and the migrations carry it forward.
#
#    DROP IT FIRST. By this point the staged database holds the migrations and whatever
#    `web-migrate-lines` copied in, and a pg_dump restored over that fails every CREATE
#    TABLE while its COPYs land on top of rows that are already there. Nothing is lost:
#    everything the staging held came from one of the two old databases, and steps 3 and
#    4 bring all of it back.
ssh root@rusty.one
  # dropdb refuses while anything holds a connection, and the staged app holds several.
  sudo -u deploy pm2 stop spoken
  sudo -u postgres dropdb --if-exists spoken
  sudo -u postgres createdb -O spoken spoken
  sudo -u postgres pg_dump voiceover | sudo -u postgres psql --set ON_ERROR_STOP=on spoken
  /srv/spoken/bin/migrate.sh /srv/spoken/current
  # Started again by step 5, which is where it picks up port 3000 and the real origin.

#    The accounts arrive here, with the quests database: five of them, one an admin. The
#    two on the zones side are merged in by step 4, by lower(email) - and today both of
#    them already exist on the quests side, so nobody new is created and both keep the
#    password they use on voiceover.rusty.one. Sessions do not move; everyone signs in
#    again against an origin that has changed anyway.

# 4. The zones half, laid over it. Rehearse first; it writes nothing. This copies the
#    corpus, flags and takes again, replacing whatever `web-migrate-lines` staged
#    earlier, so the edits and takes made between staging and the freeze come with them.
DATABASE_URL=postgres://spoken:…@127.0.0.1:5432/spoken \
ZONELORE_URL=postgres://zonelore:…@127.0.0.1:5432/zonelore \
  make web-migrate-legacy-dry
# then, if the counts look right:
  make web-migrate-legacy

# 5. Port 3000, and start.
#    Delete the PORT line from /srv/spoken/shared/app.env, set BETTER_AUTH_URL to
#    https://spoken.rusty.one there, and point the upstream in nginx-spoken.conf at 3000.
ssh deploy@rusty.one 'pm2 startOrReload /srv/spoken/shared/ecosystem.config.js --update-env'

# 6. nginx: the new vhost, and the two old ones become redirects.
ssh root@rusty.one
  cp deploy/web/nginx-spoken.conf           /etc/nginx/sites-available/spoken
  cp deploy/web/nginx-voiceover-redirect.conf /etc/nginx/sites-available/voiceover
  cp deploy/web/nginx-lore-redirect.conf      /etc/nginx/sites-available/lore
  ln -sf /etc/nginx/sites-available/spoken /etc/nginx/sites-enabled/
  nginx -t && systemctl reload nginx
```

Then flip `REMOTE_ROOT` in `make/quests.mk` and `make/zones.mk` to `/srv/spoken`, and the
zones `REMOTE_SOUNDS_DIR` to `sounds`. **Not before**: those targets rsync with `--delete`,
and a `pull` against a tree the audio has not been copied into yet would delete the local
store instead of filling it.

### Checking it

```bash
curl -fsS 'https://spoken.rusty.one/api/quests/search?q=thrall&filter=npc' | grep Thrall
curl -fsS 'https://spoken.rusty.one/api/zones/search' | head -c 200
curl -sI -H 'Range: bytes=0-1' 'https://spoken.rusty.one/api/quests/audio/quests/5-accept.mp3' | head -1   # 206
curl -sI 'https://spoken.rusty.one/api/zones/audio/1411/zone.mp3' | head -1

# every address shape the two addons have ever emitted
curl -sI 'https://voiceover.rusty.one/r/quest/5/accept'      | grep -i location  # /quests/r/quest/5/accept
curl -sI 'https://lore.rusty.one/enUS/r/1411/razor-hill'     | grep -i location  # /zones/r/1411/razor-hill
curl -sI 'https://lore.rusty.one/r/1411/razor-hill'          | grep -i location  # the same
curl -sI 'https://voiceover.rusty.one/downloads/VoiceOverReduxAudioHQ-latest.zip' | grep -i location
```

Then sign in with an account that only ever existed on the zones site, and regenerate one
line in each section with a key set on `/profile`.

`make quests-audio-status` and `make zones-audio-status` compare file counts and sizes
between the workstation and the droplet, which is the check that the copy in step 2 was
complete.

### Rolling back

Nothing about the cutover is one-way until the old trees are deleted.

```bash
ssh root@rusty.one
  cp deploy/quests/nginx-voiceover.conf /etc/nginx/sites-available/voiceover
  cp deploy/zones/nginx-lore.conf       /etc/nginx/sites-available/lore
  rm /etc/nginx/sites-enabled/spoken
  nginx -t && systemctl reload nginx
ssh deploy@rusty.one 'pm2 stop spoken && pm2 start voiceover zonelore'
```

Both old databases are untouched by the cutover — the import reads `zonelore` and writes
`spoken` — and both old audio stores still hold their own copies. What is lost is whatever
was done on the merged site in the meantime.

## Day to day

The runbook the two old deployments wrote still applies, because this is the same shape:
`deploy/quests/README.md` has the long version of how a release is assembled, why the queue
starts lazily, and what to do when pm2 keeps launching a script path that has moved. What is
new here is that there is one app where there were two, and that both sections are in every
release — a change to the shared queue, the shared roster or the shared report table is a
change to both, and shipping them apart would leave a window where one had it and the other
did not.

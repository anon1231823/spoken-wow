#!/usr/bin/env bash
#
# One-time droplet setup, written to be safe on a droplet that already runs other things
# - and this one does: ../wow-voiceover is already there, with its own user, its own pm2
# daemon, its own postgres database and 3000 already taken.
#
#   make bootstrap
#
# which is the copy and the run together. Doing it by hand is two commands, and the ssh
# half on its own says only "No such file or directory":
#
#   scp deploy/bootstrap.sh root@rusty.one:/tmp/ && ssh root@rusty.one 'bash /tmp/bootstrap.sh'
#
# This installs almost nothing. It uses the Node, pm2 and Postgres already on the box, and
# only creates a directory tree, a database and (if missing) a user. What it deliberately
# does NOT do:
#
#   - does not install or upgrade Node (yours stays exactly as it is)
#   - does not install or upgrade pm2 (ditto). pm2 daemons are per-user, so this app
#     shares the `deploy` user's daemon with voiceover if that is who runs it - which is
#     fine, they are separate pm2 apps with different names and different ports.
#   - does not touch the firewall (opening 80/443 is your call)
#   - does not install or reconfigure a web server (see nginx-lore.conf)
#
# Idempotent - safe to re-run.
set -euo pipefail

DEPLOY_USER=${DEPLOY_USER:-deploy}
ROOT=${ZONELORE_DEPLOY_ROOT:-/srv/zonelore}
DB_NAME=zonelore
DB_USER=zonelore
MIN_NODE_MAJOR=20 # next@15 requires ^18.18 || ^19.8 || >=20

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

echo "==> prerequisites"

command -v rsync >/dev/null || {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq rsync
}

# ffprobe reads the duration of every generated clip. That duration is what stops the
# addon's Play button resetting at the wrong moment, and the client cannot report it, so a
# regeneration without ffprobe fails rather than degrading. Listening and flagging work
# without it; only the Regenerate button needs it.
command -v ffprobe >/dev/null || {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq ffmpeg
}

NODE_BIN=$(command -v node || true)
[ -n "$NODE_BIN" ] || { echo "no node on PATH - install Node >= $MIN_NODE_MAJOR first" >&2; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  echo "node $(node -v) at $NODE_BIN is too old; next@15 needs >= $MIN_NODE_MAJOR" >&2
  exit 1
fi
echo "    node:   $(node -v) at $NODE_BIN"

PM2_BIN=$(command -v pm2 || true)
[ -n "$PM2_BIN" ] || {
  echo "no pm2 on PATH. Install it yourself so the version stays under your control:" >&2
  echo "    npm install -g pm2" >&2
  exit 1
}
echo "    pm2:    $(pm2 -v 2>/dev/null | tail -1) at $PM2_BIN"

command -v psql >/dev/null || {
  echo "no psql on PATH - install postgresql first, or point DATABASE_URL at a cluster" >&2
  exit 1
}
echo "    psql:   $(psql --version)"

echo "==> user ${DEPLOY_USER}"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"

echo "==> layout ${ROOT}"
# The deploy user owns everything under here, so no step of a deploy or an audio sync
# needs sudo.
#
# shared/audio-history holds superseded takes, and is a SIBLING of shared/Sounds rather
# than a subdirectory: validate-audio.mjs walks the store and would report every archived
# take as an mp3 with no manifest entry.
mkdir -p "$ROOT"/{releases,bin,shared/Sounds,shared/audio-history}
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT"

echo "==> database ${DB_NAME}"
# One role and one database on whatever cluster the box already has. Nothing global is
# touched, and ../wow-voiceover's own database is not involved.
if su - postgres -c "psql -tAc \"select 1 from pg_roles where rolname='$DB_USER'\"" | grep -q 1; then
  echo "    role $DB_USER already exists, leaving its password alone"
  PGPW=""
else
  # A password no human types, so make it long.
  PGPW=$(openssl rand -base64 24)
  su - postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE $DB_USER LOGIN PASSWORD '$PGPW'\""
  echo "    created role $DB_USER"
fi

if su - postgres -c "psql -tAc \"select 1 from pg_database where datname='$DB_NAME'\"" | grep -q 1; then
  echo "    database $DB_NAME already exists"
else
  su - postgres -c "psql -v ON_ERROR_STOP=1 -c 'CREATE DATABASE $DB_NAME OWNER $DB_USER'"
  echo "    created database $DB_NAME"
fi

# Leave listen_addresses at its default of localhost. Nothing off the box needs to reach
# this database - not even CI, which builds against a throwaway Postgres of its own.

echo "==> pm2 boot persistence for ${DEPLOY_USER}"
# Per-user: this generates a systemd unit that resurrects only what the deploy user has
# `pm2 save`d. If voiceover already runs as this user, that unit exists and this is a
# no-op re-registration.
pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER"

echo
echo "==> environment report (nothing below was changed)"
printf '    firewall:  '; (ufw status 2>/dev/null | head -1) || echo "ufw not installed"
printf '    nginx:     '; (nginx -v 2>&1) || echo "not installed"
printf '    listening: '; (ss -ltnp 2>/dev/null | grep -E ':(80|443|3000|3001) ' | tr -s ' ' | cut -d' ' -f4 | paste -sd' ' -) || true
printf '    disk:      '; df -h "$ROOT" | tail -1

cat <<EOF

==> done.

Still to do, in this order:

  1. Write ${ROOT}/shared/app.env. This is the only place the secrets exist:

       cat > ${ROOT}/shared/app.env <<'ENV'
       DATABASE_URL=postgres://${DB_USER}:${PGPW:-<the existing password>}@127.0.0.1:5432/${DB_NAME}
       ELEVENLABS_API_KEY=sk_your_key_here
       ENV
       chown ${DEPLOY_USER}:${DEPLOY_USER} ${ROOT}/shared/app.env
       chmod 600 ${ROOT}/shared/app.env

     Note 5432, not 5433 - the 5433 in .env.example is a local quirk, because
     ../wow-voiceover's docker postgres holds 5432 on the workstation.

     Leave ELEVENLABS_API_KEY out if you do not want the site able to spend credits.
     Everything except the Regenerate button works without it, and Regenerate then
     refuses with the reason rather than failing oddly.

  2. Make sure 80/443 are reachable in your existing firewall rules, then point
     lore.rusty.one at this droplet.

  3. Certificate first, then the vhost - nginx will not start referencing a certificate
     that does not exist yet:
       certbot certonly --nginx -d lore.rusty.one
       cp deploy/nginx-lore.conf /etc/nginx/sites-available/zonelore
       ln -s /etc/nginx/sites-available/zonelore /etc/nginx/sites-enabled/
       nginx -t && systemctl reload nginx

  4. From your workstation:
       make deploy-scripts     # installs bin/ + ecosystem.config.js
       make push               # uploads ~700 MB of audio

  5. Add the CI deploy key to /home/${DEPLOY_USER}/.ssh/authorized_keys, set the four
     GitHub secrets, then run the deploy workflow (see deploy/README.md).

  6. After the first deploy has created the schema, seed the database:
       make db-push

The deploy user has nothing saved for this app yet, so pm2 will not start it on boot
until the first successful deploy runs 'pm2 save'.
EOF

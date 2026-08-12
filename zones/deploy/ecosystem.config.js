/**
 * pm2 config for the voiceline explorer. Lives in /srv/zonelore/shared/ on the droplet,
 * outside every release, so it survives deploys and rollbacks.
 *
 * cwd points at the `current` symlink rather than at a release directory: activate.sh
 * swaps the symlink and reloads, and pm2 re-resolves it because we pass --update-env.
 *
 * The app runs under whatever Node pm2 itself runs under, so keep node-version in
 * .github/workflows/deploy-web.yaml in sync with the droplet's.
 *
 * Copy to the droplet with `make deploy-scripts`.
 */
const fs = require("node:fs");

const ROOT = "/srv/zonelore";
const SHARED = `${ROOT}/shared`;

/**
 * Read shared/app.env, which holds the database URL and the ElevenLabs key.
 *
 * This file is committed, so those values cannot live in it. app.env sits in shared/
 * next to the audio store: mode 600, owned by `deploy`, and never touched by a deploy or
 * a rollback. See deploy/README.md for how to create it.
 */
function readSecrets() {
  const path = `${SHARED}/app.env`;
  if (!fs.existsSync(path)) {
    // pm2 evaluates this file on every reload, so a hard failure here would take the app
    // down rather than just refusing to start with a bad config.
    console.error(`ecosystem: ${path} is missing - the app will not reach its database`);
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        // Values are taken verbatim apart from optional wrapping quotes: a password is
        // entitled to contain '#', '=' or a space.
        return [line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

module.exports = {
  apps: [
    {
      name: "zonelore",
      // Next.js standalone output. The bundle is laid out from the repo root rather than
      // from web/, because next.config.ts sets outputFileTracingRoot there so the app can
      // import tools/voice/*.mjs -- so server.js is one level down, not at the top.
      script: "web/server.js",
      cwd: `${ROOT}/current`,

      // ONE instance, deliberately, where ../wow-voiceover runs two.
      //
      // Regeneration batches live in a plain object on globalThis (web/src/lib/regenerate.ts)
      // rather than in queue tables, because this is one person on one laptop's worth of
      // work. With two workers a batch started on one would be invisible to the other, and
      // the panel's progress poll would answer "no such batch" roughly half the time.
      // invalidateCatalogue() after a lore edit is per-process for the same reason.
      //
      // The cost is a brief blip on each deploy instead of a zero-downtime rolling reload.
      // The corpus is a megabyte of Lua, not ../wow-voiceover's 15 MB of JSON, so nothing
      // here is paying for a second heap either way.
      instances: 1,
      exec_mode: "fork",

      // A safety net for a leak, not an expected limit: the memoised catalogue is 1353
      // entries and a sha1 each.
      max_memory_restart: "400M",

      // pm2's default is 1600 ms, which is shorter than a single ElevenLabs call. A
      // regeneration batch does not survive a deploy either way -- it is in-process state,
      // and that is written down as a known limitation -- but this at least lets calls
      // already in flight return and be recorded, rather than being billed for audio that
      // never reaches a take row. Do not deploy while a batch is running.
      kill_timeout: 30_000,

      env: {
        NODE_ENV: "production",
        // 3001, not 3000: ../wow-voiceover already has 3000 on this droplet. Two apps
        // silently fighting over a port is the kind of failure that looks like a bug in
        // whichever one you happen to be reading.
        PORT: 3001,
        HOSTNAME: "127.0.0.1", // nginx is the only thing that should reach the app

        // THE LOAD-BEARING FIVE. Everything under tools/ derives its paths from ROOT in
        // tools/lib/loredata.mjs, which is normally the module's own location -- and
        // cannot be, here: webpack replaces `import.meta.url` at build time, so the
        // shipped bundle carries CI's checkout path baked in. Without these the app
        // resolves every file it reads to /home/runner/work/... and serves nothing.
        //
        // The split between them is what a deploy must not destroy:

        // Per release, so a rollback moves code and data together. Covers the lore corpus
        // (addon/ZoneLore/Data/<locale>/*.lua) and the voice config (tools/voice/config.json).
        ZONELORE_ROOT: `${ROOT}/current`,

        // Shared, because a deploy must not move ~700 MB and prune.sh must not delete it.
        //
        // THIS AND ZONELORE_MANIFEST BELOW ARE ENGLISH, AND SAY SO NOWHERE. Unset, both
        // resolve per language from ZONELORE_LANG; set, they win outright. So running the
        // deployed app with ZONELORE_LANG=deDE would read and write English's audio and
        // English's manifest without complaining. Serving a second language from the
        // droplet means making these per-language paths first -- see the explorer's half
        // of the language work in README.md.
        ZONELORE_SOUNDS: `${SHARED}/Sounds`,

        // Shared, and this one's loss is permanent: version 1 of each file is the take the
        // corpus was originally cut with, and restoring it is the undo for a re-roll that
        // came out worse. Inside a release it would be gone five deploys later.
        ZONELORE_AUDIO_HISTORY: `${SHARED}/audio-history`,

        // Shared because it is written, not read: with DATABASE_URL set the database is
        // authoritative and this file is an export. It is how the addon build gets at what
        // the droplet generated -- `make pull-manifest` fetches exactly this.
        ZONELORE_MANIFEST: `${SHARED}/manifest.json`,

        // Shared so a rule hand-edited on the droplet outlives a deploy; nothing in the
        // app writes it any more. activate.sh seeds this from the release on the first
        // deploy only.
        ZONELORE_PRONUNCIATION: `${SHARED}/pronunciation.json`,

        // DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, and ZONELORE_SECRET_KEY --
        // the master key for the ElevenLabs credentials editors set on their own
        // profiles. The app has no key of its own to spend with any more.
        ...readSecrets(),
      },
    },
  ],
};

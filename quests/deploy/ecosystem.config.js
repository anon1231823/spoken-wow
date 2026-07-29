/**
 * pm2 config for the voiceline explorer. Lives in /srv/voiceover/shared/ on the droplet,
 * outside every release, so it survives deploys and rollbacks.
 *
 * cwd points at the `current` symlink rather than a release directory: activate.sh swaps
 * the symlink and reloads, and pm2 re-resolves it because we pass --update-env.
 *
 * The app runs under whatever Node pm2 itself runs under, so keep node-version in
 * .github/workflows/deploy-web.yaml in sync with the droplet's.
 *
 * Copy to the droplet with `make deploy-scripts`.
 */
const fs = require("node:fs");

const SHARED = "/srv/voiceover/shared";

/**
 * Read shared/app.env, which holds the database URL and the session secret.
 *
 * This file is committed, so those values cannot live in it. app.env sits in shared/ next
 * to the audio store: mode 600, owned by `deploy`, and never touched by a deploy or a
 * rollback. See deploy/README.md for how to create it.
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
      name: "voiceover",
      script: "server.js", // Next.js standalone output
      cwd: "/srv/voiceover/current",

      // Cluster mode is what makes `pm2 reload` zero-downtime: workers are replaced one at
      // a time. The cost is one corpus heap per instance (see max_memory_restart).
      instances: 2,
      exec_mode: "cluster",

      // loadCorpus() memoises 15 MB of parsed JSON per worker for the process lifetime,
      // measured at ~200 MB RSS. This is a safety net for a leak, not an expected limit.
      max_memory_restart: "600M",

      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "127.0.0.1", // nginx is the only thing that should reach the app

        // Audio is shared across releases (1.1 GB, never copied on deploy); the corpus
        // ships inside each release and moves with a rollback.
        VOICEOVER_AUDIO: `${SHARED}/audio`,
        VOICEOVER_CORPUS: "/srv/voiceover/current/corpus/corpus.json.gz",

        // Clips uploaded to build voice clones, shared for the same reason the audio is: a
        // cloned ElevenLabs voice cannot be exported, so these are the only way to remake
        // one. Without this, paths.ts resolves them relative to the release directory and
        // they land somewhere no Makefile target backs up.
        VOICEOVER_VOICE_SAMPLES: `${SHARED}/voices`,

        // Previous takes of regenerated lines. Shared for the strongest version of the same
        // reason: version 0 of each file is audio that predates this project's ability to
        // reproduce it, and a release directory is deleted five deploys later.
        //
        // A sibling of the store, never inside it: readStoreIndex walks audio/{quests,gossip}
        // and `make push` rsyncs audio/, so takes living under there would be mistaken for
        // store files by both.
        VOICEOVER_AUDIO_HISTORY: `${SHARED}/audio-history`,

        // Rendered pronunciation previews. Shared, and this one is load-bearing in a way the
        // others are not: unset, paths.ts resolves it to /srv/voiceover/releases/audio-previews
        // - INSIDE the directory prune.sh iterates, where it is treated as a release, occupies
        // one of the five keep slots, and is eventually rm -rf'd. Every file in it is a
        // preview someone paid credits for.
        VOICEOVER_PREVIEWS: `${SHARED}/audio-previews`,

        // generation.json, pronunciation.json and lexicon.json, which ship inside the release alongside the
        // corpus so a rollback restores the settings the rolled-back code expects. Without
        // this the app falls back to built-in defaults and, worse, applies no pronunciation
        // rules at all - "Hm" is read aloud as the letters H and M, and the lexicon editor
        // renders with no rows at all.
        VOICEOVER_VOICE_CONFIG: "/srv/voiceover/current/voice",

        // DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL and ELEVENLABS_API_KEY.
        ...readSecrets(),
      },
    },
  ],
};

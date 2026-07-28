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
        VOICEOVER_AUDIO: "/srv/voiceover/shared/audio",
        VOICEOVER_CORPUS: "/srv/voiceover/current/corpus/corpus.json.gz",
      },
    },
  ],
};

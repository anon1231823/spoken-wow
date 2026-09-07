import type { NextConfig } from "next";
import path from "node:path";

// The monorepo root, two levels up from apps/web-quests/.
const repoRoot = path.resolve(__dirname, "..", "..");

const config: NextConfig = {
  // The corpus and the audio store are read at runtime through node:fs, never bundled,
  // so they need no asset config. See src/lib/paths.ts for how they are located.

  // CI ships the build to a droplet that carries no toolchain.
  output: "standalone",

  // THE MONOREPO ROOT, not __dirname. This used to be confined to the app so tracing
  // would not walk the Python side of the repo, and that stopped working the moment
  // pnpm workspaces hoisted node_modules to the repo root: everything the bundle needs
  // then sits OUTSIDE the tracing root, and standalone shipped without `next` at all.
  // The bundle booted in CI and died with "Cannot find module 'next'".
  //
  // The cost is the layout: standalone lays out from the tracing root, so server.js
  // lands at apps/web-quests/server.js rather than at the top. The workflow, activate.sh
  // and pm2's `script` all name that path.
  outputFileTracingRoot: repoRoot,

  // AND THE EXCLUDES THAT HAVE TO COME WITH IT. Widening the root re-opened exactly what
  // the narrow one was set to prevent. Next's tracer statically evaluates the
  // path.resolve() in src/lib/paths.ts, resolves it to a real directory, and pulls the
  // whole thing in: the first build after the change traced 2,741 files and 127 MB --
  // the Python virtualenv, .pytest_cache, and pipelines/quests/.env, which holds the
  // ElevenLabs key and the database password. A release bundle is rsynced to the
  // droplet, so that is a credential leak and not merely weight. With these excludes the
  // bundle is 4.6 MB.
  //
  // THE GLOBS ARE RELATIVE TO THIS DIRECTORY, NOT TO THE TRACING ROOT. That is not what
  // the option's name suggests and it fails silently: "pipelines/**" matches nothing and
  // excludes nothing, which is how the leak survived its first fix. Hence "../../".
  //
  // The corpus and the voice config are excluded here too, deliberately. They still
  // reach the droplet: the deploy workflow copies them into the release by glob, so a
  // rollback moves data and code together. Tracing them in as well would ship them twice
  // and let a stale copy win.
  outputFileTracingExcludes: {
    "*": [
      "../../pipelines/**",
      "../../addons/**",
      "../../apps/web-zones/**",
      "../../curseforge/**",
      "../../deploy/**",
      "../../dist/**",
      "../../docs/**",
      "../../make/**",
      "../../scripts/**",
      "../../tests/**",
    ],
  },
};

export default config;

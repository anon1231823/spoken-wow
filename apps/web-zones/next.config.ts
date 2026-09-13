import type { NextConfig } from "next";
import path from "node:path";

// The repo root, two levels up from apps/web-zones/.
const repoRoot = path.resolve(process.cwd(), "..", "..");

const config: NextConfig = {
  // THE LOAD-BEARING SETTING. Server code here imports the zones pipeline's
  // voice/*.mjs directly --
  // the catalogue reader, the ElevenLabs client, the concurrency limiter -- so that
  // the CLI and this app run one copy of that logic rather than two that drift.
  // Those files live in pipelines/zones/, outside this app, and without this Next
  // traces dependencies from apps/web-zones/ alone and leaves them out of the build.
  //
  // Since the monorepo merge this is also what puts node_modules inside the tracing
  // root: pnpm hoists them there, and the quests app -- which used to trace from its
  // own directory -- shipped a bundle with no `next` in it until it was widened too.
  //
  // The alternative was spawning `node voice/generate.mjs` and parsing stdout,
  // which loses the error kinds and the character-cost header and reintroduces
  // exactly the divergence store.mjs exists to prevent.
  outputFileTracingRoot: repoRoot,

  // The droplet has no repo, no pnpm and no build toolchain: CI ships it a self-contained
  // bundle with its traced node_modules. Combined with the tracing root above, the bundle
  // is laid out from the repo root -- server.js lands in
  // .next/standalone/apps/web-zones/, not at the top -- because the pipeline's
  // voice/*.mjs has to keep resolving by its real relative path.
  output: "standalone",

  // The pipeline is plain ESM with no build step and no types. Next compiles what it
  // traces; these are already valid ESM, so they only need to not be treated as
  // browser-bundled code.
  serverExternalPackages: ["pg"],

  // The same guard the quests app needs, for the same reason and with the same trap:
  // a wide tracing root lets Next's static evaluation of a path.resolve() drag an
  // entire sibling directory into the bundle -- there it was the Python virtualenv and
  // a .env holding live credentials. This app does not do that today; nothing stops the
  // next refactor from doing it.
  //
  // THE GLOBS ARE RELATIVE TO THIS DIRECTORY, NOT TO THE TRACING ROOT, which is not what
  // the name suggests and fails silently when you get it wrong. Hence "../../".
  //
  // pipelines/zones is deliberately absent: this app imports its voice/*.mjs, and while
  // webpack compiles them in rather than copying them, excluding the directory would
  // make that a build-order accident rather than a decision.
  outputFileTracingExcludes: {
    "*": [
      "../../pipelines/quests/**",
      "../../addons/**",
      "../../apps/web/**",
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

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
  // Tracing from the monorepo root rather than from the old repo root pulls a wider
  // tree into the standalone bundle; the deploy workflow asserts a size ceiling on
  // the assembled release so that growth cannot go unnoticed.
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
};

export default config;

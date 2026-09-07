import type { NextConfig } from "next";
import path from "node:path";

// The repo root, one level up from web/.
const repoRoot = path.resolve(process.cwd(), "..");

const config: NextConfig = {
  // THE LOAD-BEARING SETTING. Server code here imports tools/voice/*.mjs directly --
  // the catalogue reader, the ElevenLabs client, the concurrency limiter -- so that
  // the CLI and this app run one copy of that logic rather than two that drift.
  // Those files live outside web/, and without this Next traces dependencies from
  // web/ alone and leaves them out of the build.
  //
  // The alternative was spawning `node tools/voice/generate.mjs` and parsing stdout,
  // which loses the error kinds and the character-cost header and reintroduces
  // exactly the divergence store.mjs exists to prevent.
  outputFileTracingRoot: repoRoot,

  // The droplet has no repo, no pnpm and no build toolchain: CI ships it a self-contained
  // bundle with its traced node_modules. Combined with the tracing root above, the bundle
  // is laid out from the repo root -- server.js lands in .next/standalone/web/, not at the
  // top -- because tools/voice/*.mjs has to keep resolving by its real relative path.
  output: "standalone",

  // tools/ is plain ESM with no build step and no types. Next compiles what it
  // traces; these are already valid ESM, so they only need to not be treated as
  // browser-bundled code.
  serverExternalPackages: ["pg"],
};

export default config;

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

  // tools/ is plain ESM with no build step and no types. Next compiles what it
  // traces; these are already valid ESM, so they only need to not be treated as
  // browser-bundled code.
  serverExternalPackages: ["pg"],
};

export default config;

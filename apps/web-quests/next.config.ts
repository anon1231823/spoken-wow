import type { NextConfig } from "next";

const config: NextConfig = {
  // The corpus and the audio store are read at runtime through node:fs, never bundled,
  // so they need no asset config. See src/lib/paths.ts for how they are located.

  // CI ships the build to a droplet that carries no toolchain.
  output: "standalone",
  // Confine tracing to web/, so it does not walk the Python side of the repo.
  outputFileTracingRoot: __dirname,
};

export default config;

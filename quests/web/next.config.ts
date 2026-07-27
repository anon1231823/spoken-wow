import type { NextConfig } from "next";

const config: NextConfig = {
  // The corpus and the audio store live outside web/, at the repo root. Nothing here is
  // bundled - both are read at runtime through node:fs - so no asset config is needed.
  experimental: {},
};

export default config;

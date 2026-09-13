import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

/**
 * Read .env.local the way `next dev` does.
 *
 * Vitest does not, and history.test.ts needs DATABASE_URL: it exercises the version table
 * against a real Postgres, because the constraints that keep its ordering honest live in the
 * schema rather than in the code. CI sets DATABASE_URL in the job environment, and a real
 * environment variable wins over anything read here.
 */
function localEnv(): Record<string, string> {
  const file = path.resolve(__dirname, ".env.local");
  if (!fs.existsSync(file)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, "")];
      })
      .filter(([key]) => !(key in process.env)),
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: localEnv(),
    /**
     * One test file at a time.
     *
     * The queue tests claim from a real, shared table, and claiming is by definition
     * global - there is no per-run prefix that `claimNext` could respect. Files running in
     * parallel would take each other's jobs and fail perhaps one run in three, which is the
     * worst kind of test failure to own. The suite is small enough that the wall-clock cost
     * is seconds.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      /**
       * `server-only` resolved the way the server resolves it.
       *
       * The package exports a throwing module by default and an empty one under the
       * `react-server` condition, which is how it turns "imported from a client component"
       * into a build error. Vitest runs in plain node, gets the throwing one, and every
       * server module that imports it - lib/api-key.ts, and everything reaching it - fails
       * to load. Pointed at the same empty module the server condition selects.
       */
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
});

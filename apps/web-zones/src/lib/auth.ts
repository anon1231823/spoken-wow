/**
 * The Better Auth server instance. Everything that reads or writes a session goes through
 * this module: the catch-all route handler, the API guards in authz.ts, and the two
 * server-rendered pages that check a role.
 *
 * Email and password only, with no verification step -- this is a small tool with a handful
 * of contributors, and an SMTP dependency would be the largest moving part in it.
 */
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";

import { pool } from "./db";
import { ac, roles } from "./permissions";

/**
 * A fixed secret for local work, and only for local work.
 *
 * Better Auth refuses to start without one, and `make web` runs `next dev` inside web/,
 * which does not read the repo root's .env -- so with no fallback the first thing a clone
 * of this repo does is fail to boot over a value that does not matter on a laptop.
 *
 * Guarded on NODE_ENV rather than defaulted outright: a deploy that forgot
 * BETTER_AUTH_SECRET must fail loudly at boot, not come up quietly signing cookies with a
 * secret that is committed to a public repository.
 *
 * `next build` sets NODE_ENV=production, so a local `pnpm build` with no secret set logs
 * a BetterAuthError per prerendered page and then succeeds. That is the guard working:
 * the pages that matter are dynamic, and the build is not the runtime. CI sets the
 * variable, so CI builds are quiet.
 */
const secret =
  process.env.BETTER_AUTH_SECRET ??
  (process.env.NODE_ENV === "production" ? undefined : "zonelore-development-secret");

export const auth = betterAuth({
  secret,
  // The explorer's own pool, not a second one. It is already memoised on globalThis
  // against the dev server's hot reloads, and a session lookup is a smaller query than
  // anything else this app runs.
  database: pool(),
  emailAndPassword: { enabled: true },
  // nginx terminates TLS, so the origin Better Auth infers is http://127.0.0.1:3001
  // unless it is told the public one. Cookies and redirects are built from this, and the
  // Origin header of every state-changing request is checked against it -- a stale value
  // does not fail at boot, it fails every sign-in with "Invalid origin".
  baseURL: process.env.BETTER_AUTH_URL,
  plugins: [
    adminPlugin({
      ac,
      roles,
      // Registration therefore grants nothing. See permissions.ts.
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
    // Lets route handlers set the session cookie. Must stay last.
    nextCookies(),
  ],
});

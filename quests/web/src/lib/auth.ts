/**
 * The Better Auth server instance. Everything that reads or writes a session goes through
 * this module: the catch-all route handler, and the /admin page's guard.
 *
 * Email and password only, with no verification step — the explorer is a small tool with a
 * handful of contributors, and an SMTP dependency would be the largest moving part in it.
 */
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";
import { Pool } from "pg";

import { ac, roles } from "./permissions";

// `new Pool()` does not open a connection until the first query, so importing this module
// during `next build` does not need a reachable database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true },
  // nginx terminates TLS, so the origin Better Auth sees is http://127.0.0.1:3000 unless we
  // tell it the public one. Cookies and redirects are built from this.
  baseURL: process.env.BETTER_AUTH_URL,
  plugins: [
    adminPlugin({
      ac,
      roles,
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
    // Lets server actions and route handlers set the session cookie. Must stay last.
    nextCookies(),
  ],
});

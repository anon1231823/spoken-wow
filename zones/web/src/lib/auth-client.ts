/**
 * The browser half of Better Auth. Passing the same `ac` and `roles` as the server gives
 * the client typed role names and lets it answer permission questions without a round trip.
 *
 * What the browser decides is only what to draw. Every one of those decisions is made
 * again on the server in authz.ts, because a hidden button is not an access control.
 */
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles })],
});

export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * The signed-in session, read once per render.
 *
 * A page under a language asks who is looking more than once -- the layout whether they may
 * see a language that is switched off, the page whether they may edit it -- and each asking
 * was its own session lookup. React's cache dedupes those within one server render; a route
 * handler, which has no render, simply reads it as it always did.
 */
import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "@/lib/auth";

export const currentSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

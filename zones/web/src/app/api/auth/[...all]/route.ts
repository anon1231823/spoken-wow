import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

// Sign in, sign up, sign out, session, and the admin plugin's user management. Better
// Auth owns every path under /api/auth; there is nothing to add here.
export const { GET, POST } = toNextJsHandler(auth);

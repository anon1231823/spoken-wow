import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { UserTable } from "@/components/UserTable";
import { userIdsWithApiKey } from "@/lib/api-key";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

export const metadata: Metadata = { title: "Users" };

/**
 * Who may do what. The real boundary for role changes is Better Auth's own admin plugin,
 * which checks the caller's role on every setRole call; this guard only decides whether
 * the page renders at all.
 */
export default async function Page() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  // 404 rather than a redirect to /login: a member has no business learning this exists.
  if (!session || !isAdmin(session.user.role)) notFound();

  const { users } = await auth.api.listUsers({
    headers: requestHeaders,
    query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
  });

  // Which accounts hold a key, and nothing else about it. An admin hands out the role
  // that spends, so they must be able to take back what it spends with; reading a
  // colleague's credential is not part of that, so no value crosses this boundary --
  // not even the redacted hint the owner sees on their own profile.
  const keyed = await userIdsWithApiKey();

  return (
    <main className="shell pt-8 pb-24">
      <h1 className="text-xl font-semibold">Users</h1>
      <p className="mt-1 mb-5 text-muted">
        Everyone who registers starts as a <strong className="text-fg">member</strong>, which
        sees exactly what a visitor sees. An <strong className="text-fg">editor</strong> may
        flag lines and regenerate them, which spends credits. An{" "}
        <strong className="text-fg">admin</strong> may also edit the pronunciation rules and
        change these roles. Regenerating spends credits from the editor&apos;s own ElevenLabs
        account, so a role is only half of it — the key is theirs, set on their profile.
      </p>
      <UserTable users={users} currentUserId={session.user.id} keyedUserIds={keyed} />
    </main>
  );
}

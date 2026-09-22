import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import LanguageTable from "@/components/LanguageTable";
import UserTable from "@/components/UserTable";
import { userIdsWithApiKey } from "@/lib/api-key";
import { auth } from "@/lib/auth";
import { langName } from "@/lib/lang";
import { languageStates } from "@/lib/languages/store";
import { isAdmin } from "@/lib/permissions";

export const metadata: Metadata = { title: "Users · Spoken" };

/**
 * The only server-rendered session check in the app, and the real access boundary for user
 * management — the client-side role checks elsewhere only decide what to draw.
 */
export default async function Page() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  // 404 rather than a redirect: a member has no business learning this page exists.
  if (!session || !isAdmin(session.user.role)) notFound();

  const { users } = await auth.api.listUsers({
    headers: requestHeaders,
    query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
  });

  // Which accounts hold a key, and nothing else about it. An admin hands out the role that
  // spends, so they must be able to take back what it spends with; reading a colleague's
  // credential is not part of that, so no value crosses this boundary -- not even the
  // redacted hint the owner sees on their own profile.
  const [keyed, languages] = await Promise.all([userIdsWithApiKey(), languageStates()]);

  return (
    <main className="mx-auto max-w-4xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">Users</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Collaborators and admins can regenerate voicelines. Everyone who registers starts as
        a member. Regenerating spends credits from the collaborator&apos;s own ElevenLabs
        account, so a role is only half of it — the key is theirs, set on their profile.
      </p>
      <UserTable users={users} currentUserId={session.user.id} keyedUserIds={keyed} />

      <h2 className="mt-10 text-lg font-semibold">Languages</h2>
      <p className="text-muted-foreground mt-1 mb-4 text-sm">
        A language switched on appears in everyone&apos;s header. One that is off can still be
        opened by an admin at its address, to prepare it before anybody else sees it.
      </p>
      <LanguageTable
        initial={languages.map((state) => ({ ...state, name: langName(state.code) }))}
      />
    </main>
  );
}

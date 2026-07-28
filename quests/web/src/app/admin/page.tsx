import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import UserTable from "@/components/UserTable";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

export const metadata: Metadata = { title: "Users · VoiceOver Explorer" };

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

  return (
    <main className="mx-auto max-w-4xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">Users</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Collaborators and admins can regenerate voicelines. Everyone who registers starts as
        a member.
      </p>
      <UserTable users={users} currentUserId={session.user.id} />
    </main>
  );
}

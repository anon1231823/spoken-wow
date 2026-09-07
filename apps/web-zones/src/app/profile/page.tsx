import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ApiKeySection } from "@/components/ApiKeySection";
import { apiKeyStatus } from "@/lib/api-key";
import { currentSession } from "@/lib/authz";
import { canRegenerate } from "@/lib/permissions";

export const metadata: Metadata = { title: "Profile" };

// The account's own page. A redirect to /login rather than the 404 /admin and /voice
// give a member: every signed-in user has a profile, so the only question here is who
// is asking, and signing in answers it.
export default async function Page() {
  const session = await currentSession();
  if (!session) redirect("/login");

  const role = session.user.role;
  // The status, never the key. Sent to a client component as props, so this is the
  // shape that decides what the browser can possibly learn.
  const status = canRegenerate(role) ? await apiKeyStatus(session.user.id) : null;

  return (
    <main className="shell pt-8 pb-24">
      <h1 className="text-xl font-semibold">Profile</h1>

      <dl className="mt-4 mb-8 grid max-w-md grid-cols-[6rem_1fr] gap-y-1">
        <dt className="text-muted">Email</dt>
        <dd>{session.user.email}</dd>
        <dt className="text-muted">Role</dt>
        <dd>
          <span className="rounded border border-border px-1.5 text-xs uppercase">
            {role ?? "member"}
          </span>
        </dd>
      </dl>

      {canRegenerate(role) ? (
        <ApiKeySection initial={status} />
      ) : (
        // Said rather than hidden: a member who has been told "go and regenerate that
        // line" needs to know which of the two things they are missing.
        <p className="max-w-xl text-muted">
          Generating audio needs the <strong className="text-fg">editor</strong> role. Ask an
          admin for it, and this page will then ask you for an ElevenLabs key of your own.
        </p>
      )}
    </main>
  );
}

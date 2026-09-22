/**
 * Setting, replacing and clearing the signed-in user's ElevenLabs key.
 *
 * NOTHING HERE EVER RETURNS A KEY. Not after a successful save, not behind a "reveal"
 * control, not to an admin. What a response carries is `ApiKeyStatus` -- the last four
 * characters, when it was verified, and the plan -- which is enough to show that a key is
 * set and useless for spending with.
 *
 * Gated on spending credits somewhere rather than on being signed in: a member has no action
 * a key would unblock, so storing a credential for them would be collecting a secret this
 * app has no use for. Somewhere includes a language grant -- a translator who may regenerate
 * Portuguese pays for it with their own key like anybody else.
 */
import { apiKeyStatus, deleteApiKey, storeApiKey } from "@/lib/api-key";
import { viewerOf } from "@/lib/grants/store";
import { isAdmin, spendsCredits } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { getSubscription } from "@/lib/voices/elevenlabs";

export const dynamic = "force-dynamic";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

/** The session of somebody who may hold a key, or null. */
async function spender() {
  const session = await currentSession();
  return session && spendsCredits(await viewerOf(session)) ? session : null;
}

export async function GET() {
  const session = await spender();
  if (!session) return FORBIDDEN();

  return Response.json({ status: await apiKeyStatus(session.user.id) });
}

export async function POST(request: Request) {
  const session = await spender();
  if (!session) return FORBIDDEN();

  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key === "") return Response.json({ error: "a key is required" }, { status: 400 });

  // Verified before it is stored, by the one call that costs nothing and answers with the
  // plan. A typo would otherwise first surface as a 401 in the middle of a batch, where
  // "auth" is correctly fatal - so a bad paste would cost a whole regeneration pass instead
  // of one message here.
  let tier: string | null;
  try {
    ({ tier } = await getSubscription({ apiKey: key }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  return Response.json({ status: await storeApiKey(session.user.id, key, tier) });
}

/**
 * Clears a key: the caller's own, or -- with ?userId= -- somebody else's, for admins.
 *
 * An admin can hand out the collaborator role, so they must be able to take back what it
 * lets someone spend with; a collaborator who leaves should not need psql to be un-keyed.
 * That is the whole of the power: an admin may remove a key and see that one exists, never
 * read one.
 */
export async function DELETE(request: Request) {
  const session = await currentSession();
  if (!session) return FORBIDDEN();

  const target = new URL(request.url).searchParams.get("userId");

  if (target && target !== session.user.id) {
    if (!isAdmin(session.user.role)) return FORBIDDEN();
    await deleteApiKey(target);
    return Response.json({ cleared: true });
  }

  await deleteApiKey(session.user.id);
  return Response.json({ status: null });
}

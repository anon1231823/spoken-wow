import { NextResponse } from "next/server";

import { apiKeyStatus, deleteApiKey, storeApiKey } from "@/lib/api-key";
import { currentSession } from "@/lib/authz";
import { canRegenerate, isAdmin } from "@/lib/permissions";
import { verifyKey } from "@/lib/tools";

// Setting, replacing and clearing the signed-in user's ElevenLabs key.
//
// NOTHING HERE EVER RETURNS A KEY. Not after a successful save, not behind a "reveal"
// control, not to an admin. What a response carries is `ApiKeyStatus` -- the last four
// characters, when it was verified, and the plan -- which is enough to show that a key
// is set and useless for spending with.
//
// Gated on canRegenerate rather than on being signed in: a member has no action a key
// would unblock, so storing a credential for them would be collecting a secret this app
// has no use for.

export async function GET() {
  const session = await currentSession();
  if (!session || !canRegenerate(session.user.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  return NextResponse.json({ status: await apiKeyStatus(session.user.id) });
}

type Body = { key?: unknown };

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session || !canRegenerate(session.user.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key === "") {
    return NextResponse.json({ error: "a key is required" }, { status: 400 });
  }

  // Verified before it is stored. A typo would otherwise first surface as a 401 in the
  // middle of a batch, where isFatal() correctly abandons the rest of the run -- so a
  // bad paste would cost a whole regeneration pass instead of one message here.
  let tier: string | null;
  try {
    ({ tier } = await verifyKey(key));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  return NextResponse.json({ status: await storeApiKey(session.user.id, key, tier) });
}

/**
 * Clears a key: the caller's own, or -- with ?userId= -- somebody else's, for admins.
 *
 * An admin can hand out the editor role, so they must be able to take back what it lets
 * someone spend with; a collaborator who leaves should not need psql to be un-keyed.
 * That is the whole of the power: an admin may remove a key and see that one exists,
 * never read one.
 */
export async function DELETE(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "not allowed" }, { status: 403 });

  const target = new URL(request.url).searchParams.get("userId");

  if (target && target !== session.user.id) {
    if (!isAdmin(session.user.role)) {
      return NextResponse.json({ error: "not allowed" }, { status: 403 });
    }
    await deleteApiKey(target);
    return NextResponse.json({ cleared: true });
  }

  await deleteApiKey(session.user.id);
  return NextResponse.json({ status: null });
}

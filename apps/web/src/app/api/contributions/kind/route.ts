/**
 * A moderator's answer to "which NPC is this?", for a contribution whose envelope named its NPC
 * by id alone.
 *
 * Recorded on the contribution, not in npc_resolution: the answers there are about NPCs and are
 * not wrong, only ambiguous for this row, which could mean either kind. After this every reader
 * (the triage page, accept, the export) reads the row as if its envelope had carried the kind.
 * Refused for a row whose envelope already carried one -- the client's own observation stands.
 *
 * Collaborator-only, like the other moderator routes beside it.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { setContributionNpcKind } from "@/lib/contributions/store";
import { NPC_KINDS, type NpcKind } from "@/lib/npc/npc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { id?: unknown; npcKind?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }
  if (!(NPC_KINDS as readonly unknown[]).includes(body.npcKind)) {
    return Response.json({ error: "unknown kind" }, { status: 400 });
  }

  const recorded = await setContributionNpcKind(id, body.npcKind as NpcKind);
  if (!recorded) {
    return Response.json({ error: "no such contribution, or its envelope already names the kind" }, { status: 409 });
  }
  return Response.json({ ok: true });
}

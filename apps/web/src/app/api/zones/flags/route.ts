/**
 * What a person decided about a zone line after listening to it.
 *
 * Collaborators and admins only. A verdict is a claim about the audio that other people
 * act on -- `flag=bad` is the regeneration worklist -- so it is not something a passer-by
 * writes. That is what a report is, and reports go through /api/reports.
 *
 * status 'bad' | 'ok' sets it, null clears it back to unreviewed. Clearing has to be
 * possible: a mis-tapped key during a fast listening pass is otherwise permanent, and an
 * unreviewed line is a real state rather than the absence of one.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { query } from "@/lib/db";
import { isKnownLine } from "@/lib/zones/catalogue";

export const dynamic = "force-dynamic";

type Body = { lineId?: unknown; status?: unknown; note?: unknown };

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const { lineId, status, note } = (await request.json().catch(() => ({}))) as Body;

  if (typeof lineId !== "string" || lineId === "") {
    return Response.json({ error: "lineId is required" }, { status: 400 });
  }
  // Validated against the catalogue rather than trusted: line_flag has no foreign key -- a
  // line can be flagged before it has audio -- so this is the only thing stopping a typo
  // becoming a row nothing will ever show or clean up.
  if (!(await isKnownLine(lineId))) {
    return Response.json({ error: `unknown lineId ${lineId}` }, { status: 400 });
  }
  if (status !== null && status !== "bad" && status !== "ok") {
    return Response.json({ error: "status must be 'bad', 'ok' or null" }, { status: 400 });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return Response.json({ error: "note must be a string or null" }, { status: 400 });
  }

  if (status === null) {
    await query(`delete from "line_flag" where "lineId" = $1`, [lineId]);
    return Response.json({ lineId, flag: null });
  }

  const rows = await query<{ status: "bad" | "ok"; note: string | null; updatedAt: Date }>(
    // "lang" is left to its 'enUS' default; the conflict target still names it because
    // that is the unique index the merge left on this table.
    `insert into "line_flag" ("lineId", "status", "note")
     values ($1, $2, $3)
     on conflict ("lineId", "lang") do update
       set "status" = excluded."status",
           -- A note is only overwritten when one was actually sent. Flagging a line that
           -- already carries a written note must not silently erase it.
           "note" = coalesce(excluded."note", "line_flag"."note"),
           "updatedAt" = now()
     returning "status", "note", "updatedAt"`,
    [lineId, status, note ?? null],
  );

  const row = rows[0];
  return Response.json({
    lineId,
    flag: { status: row.status, note: row.note, updatedAt: row.updatedAt.toISOString() },
  });
}

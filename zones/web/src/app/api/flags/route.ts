import { NextResponse } from "next/server";

import { requireReview } from "@/lib/authz";
import { catalogue } from "@/lib/catalogue";
import { query } from "@/lib/db";

// What a person decided about a line after listening to it.
//
// Editors and admins only. A verdict is a claim about the audio that other people act on
// -- `flag=bad` is the regeneration worklist -- so it is not something a passer-by writes.
//
// status 'bad' | 'ok' sets it, null clears it back to unreviewed. Clearing has to be
// possible: a mis-tapped `f` during a fast listening pass is otherwise permanent, and
// an unreviewed line is a real state rather than the absence of one.

type Body = {
  lineId?: unknown;
  status?: unknown;
  note?: unknown;
};

async function isKnownLine(lineId: string): Promise<boolean> {
  const entries = await catalogue();
  return entries.some((entry) => entry.id === lineId);
}

export async function POST(request: Request) {
  const { denied } = await requireReview();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Body;

  const { lineId, status, note } = body;

  if (typeof lineId !== "string" || lineId === "") {
    return NextResponse.json({ error: "lineId is required" }, { status: 400 });
  }
  // Validated against the catalogue rather than trusted: line_flag has no foreign key
  // (a line can be flagged before it has audio), so this is the only thing stopping a
  // typo becoming a row that nothing will ever show or clean up.
  if (!(await isKnownLine(lineId))) {
    return NextResponse.json({ error: `unknown lineId ${lineId}` }, { status: 400 });
  }
  if (status !== null && status !== "bad" && status !== "ok") {
    return NextResponse.json({ error: "status must be 'bad', 'ok' or null" }, { status: 400 });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
  }

  if (status === null) {
    await query(`delete from "line_flag" where "lineId" = $1`, [lineId]);
    return NextResponse.json({ lineId, flag: null });
  }

  const rows = await query<{ status: "bad" | "ok"; note: string | null; updatedAt: Date }>(
    `insert into "line_flag" ("lineId", "status", "note")
     values ($1, $2, $3)
     on conflict ("lineId") do update
       set "status" = excluded."status",
           -- A note is only overwritten when one was actually sent. Tapping f on a
           -- line that already carries a written note must not silently erase it.
           "note" = coalesce(excluded."note", "line_flag"."note"),
           "updatedAt" = now()
     returning "status", "note", "updatedAt"`,
    [lineId, status, note ?? null],
  );

  const row = rows[0];
  return NextResponse.json({
    lineId,
    flag: { status: row.status, note: row.note, updatedAt: row.updatedAt.toISOString() },
  });
}

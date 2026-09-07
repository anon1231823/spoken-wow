import { NextResponse } from "next/server";

import { requireFeedback } from "@/lib/authz";
import { query } from "@/lib/db";
import { isStatus } from "@/lib/feedback";

// Ruling on a report.
//
// ITS OWN FILE, not another action on /api/feedback. That route's POST is open to the
// whole internet; this one must never be. Two verbs on one path with opposite access
// rules is the kind of arrangement a later edit quietly breaks, and the failure mode is
// a guest closing their own complaints.
//
// Reopening is a first-class move, not an undo hidden somewhere else: it clears
// resolvedAt and resolvedBy so a mis-clicked "fixed" leaves nothing behind, which is the
// argument api/flags makes for clearing a flag.

type Body = {
  id?: unknown;
  status?: unknown;
};

export async function POST(request: Request) {
  const { session, denied } = await requireFeedback();
  if (denied) return denied;

  const { id, status } = (await request.json().catch(() => ({}))) as Body;

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });
  }
  if (!isStatus(status)) {
    return NextResponse.json(
      { error: "status must be 'open', 'not_an_issue' or 'fixed'" },
      { status: 400 },
    );
  }

  const rows = await query<{ id: number; status: string; resolvedAt: Date | null }>(
    `update "feedback"
        set "status" = $2,
            "resolvedAt" = case when $2 = 'open' then null else now() end,
            "resolvedBy" = case when $2 = 'open' then null else $3 end
      where "id" = $1
      returning "id", "status", "resolvedAt"`,
    [id, status, session.user.id],
  );

  const row = rows[0];
  if (!row) return NextResponse.json({ error: `no feedback ${id}` }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    status: row.status,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    // Echoed so the panel can show who closed it without a refetch. The row was just
    // written by this session, so this is the truth rather than a guess.
    resolverEmail: status === "open" ? null : session.user.email,
  });
}

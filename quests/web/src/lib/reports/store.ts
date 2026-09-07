/**
 * The only module that knows line_report's column names, following lib/generation/queue.ts.
 *
 * countRecent is the rate limiter's entire implementation. It counts in Postgres rather than
 * in process memory so the limit survives a pm2 restart, which is precisely the moment a
 * flood would otherwise get through.
 */
import { db } from "@/lib/db";

import type { Category, Report, Status } from "./reports";

// Timestamps are cast to text so a Report is the same shape in Postgres, over JSON and in the
// browser. `pg` hands back Date objects for timestamptz, which survive neither the wire nor a
// server-to-client component boundary as themselves.
const COLUMNS = `"id", "lineId", "target", "category", "body", "status", "userId", "name",
                 "email", "createdAt"::text, "resolvedAt"::text, "resolvedBy"`;

export async function createReport(input: {
  lineId: string | null;
  target: string;
  category: Category;
  body: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  ip: string | null;
}): Promise<void> {
  // Returns nothing: the reporter cannot read a report back, so an id would only be a handle
  // on something they cannot reach.
  await db().query(
    `insert into "line_report"
       ("lineId", "target", "category", "body", "userId", "name", "email", "ip")
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.lineId,
      input.target,
      input.category,
      input.body,
      input.userId,
      input.name,
      input.email,
      input.ip,
    ],
  );
}

export async function countRecent(ip: string, withinMs: number): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    `select count(*)::text as count
       from "line_report"
      where "ip" = $1
        and "createdAt" > now() - ($2::bigint * interval '1 millisecond')`,
    [ip, withinMs],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listReports(status: Status | "all", limit = 500): Promise<Report[]> {
  const filtered = status !== "all";
  const { rows } = await db().query<Report>(
    `select ${COLUMNS}
       from "line_report"
      ${filtered ? `where "status" = $2` : ""}
      order by "createdAt" desc
      limit $1`,
    filtered ? [limit, status] : [limit],
  );
  return rows;
}

export async function reportsForLine(lineId: string): Promise<Report[]> {
  const { rows } = await db().query<Report>(
    `select ${COLUMNS}
       from "line_report"
      where "lineId" = $1
      order by "status" = 'open' desc, "createdAt" desc`,
    [lineId],
  );
  return rows;
}

export async function setStatus(
  id: number,
  status: Status,
  userId: string,
): Promise<Report | null> {
  // Reopening clears the resolution rather than leaving a stale resolver on an open report.
  const { rows } = await db().query<Report>(
    `update "line_report"
        set "status" = $2,
            "resolvedAt" = case when $2 = 'open' then null else now() end,
            "resolvedBy" = case when $2 = 'open' then null else $3 end
      where "id" = $1
      returning ${COLUMNS}`,
    [id, status, userId],
  );
  return rows[0] ?? null;
}

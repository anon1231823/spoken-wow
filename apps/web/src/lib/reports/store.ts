/**
 * The only module that knows the report table's column names, following lib/generation/queue.ts.
 *
 * One table for both sides of the site (migration 0021), so every read takes a source filter
 * rather than pinning one: the triage page shows both by default, because a report is a
 * person waiting for an answer and which corpus it is about does not change how long they
 * have been waiting.
 *
 * countRecent is the rate limiter's entire implementation. It counts in Postgres rather than
 * in process memory so the limit survives a pm2 restart, which is precisely the moment a
 * flood would otherwise get through. It does not filter by source, deliberately: the limit is
 * on a person, and filing ten from each page is filing twenty.
 */
import { db } from "@/lib/db";

import type { Category, Report, Source, Status } from "./reports";

// Timestamps are cast to text so a Report is the same shape in Postgres, over JSON and in the
// browser. `pg` hands back Date objects for timestamptz, which survive neither the wire nor a
// server-to-client component boundary as themselves.
const COLUMNS = `"id", "source", "lineId", "target", "category", "body", "status", "userId",
                 "name", "email", "createdAt"::text, "resolvedAt"::text, "resolvedBy"`;

export async function createReport(input: {
  source: Source;
  lang?: string;
  lineId: string | null;
  target: string | null;
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
    `insert into "report"
       ("source", "lang", "lineId", "target", "category", "body", "userId", "name", "email", "ip")
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.source,
      input.lang ?? "enUS",
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
       from "report"
      where "ip" = $1
        and "createdAt" > now() - ($2::bigint * interval '1 millisecond')`,
    [ip, withinMs],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listReports(
  status: Status | "all",
  source: Source | "all" = "all",
  limit = 500,
): Promise<Report[]> {
  const where: string[] = [];
  const params: unknown[] = [limit];
  if (status !== "all") where.push(`"status" = $${params.push(status)}`);
  if (source !== "all") where.push(`"source" = $${params.push(source)}`);

  const { rows } = await db().query<Report>(
    `select ${COLUMNS}
       from "report"
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by "createdAt" desc
      limit $1`,
    params,
  );
  return rows;
}

export async function reportsForLine(source: Source, lineId: string): Promise<Report[]> {
  const { rows } = await db().query<Report>(
    `select ${COLUMNS}
       from "report"
      where "source" = $1 and "lineId" = $2
      order by "status" = 'open' desc, "createdAt" desc`,
    [source, lineId],
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
    `update "report"
        set "status" = $2,
            "resolvedAt" = case when $2 = 'open' then null else now() end,
            "resolvedBy" = case when $2 = 'open' then null else $3 end
      where "id" = $1
      returning ${COLUMNS}`,
    [id, status, userId],
  );
  return rows[0] ?? null;
}

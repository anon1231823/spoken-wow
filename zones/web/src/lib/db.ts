// The explorer's database access.
//
// Separate from tools/voice/db.mjs deliberately: that pool belongs to short-lived CLI
// runs that open it, do one job and close it. This one lives for the process and is
// cached across dev-server hot reloads, which otherwise leak a pool per edit until
// Postgres refuses new connections.

import pg from "pg";

// numeric and int8 come back as strings by default -- correct in general, since both
// are wider than a JS number, and wrong here, where they are ffprobe durations and
// mp3 byte counts. The same two parsers are set in tools/voice/db.mjs; a duration that
// arrives as "49.6" would render as a string and sort lexically.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://zonelore:zonelore@localhost:5433/zonelore";

// Cached on globalThis rather than in a module variable: `next dev` re-evaluates
// modules on every change, and a fresh Pool each time exhausts Postgres's connection
// limit within an afternoon of editing.
const globalForPg = globalThis as unknown as { zonelorePool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPg.zonelorePool) {
    globalForPg.zonelorePool = new pg.Pool({ connectionString: DATABASE_URL });
  }
  return globalForPg.zonelorePool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}

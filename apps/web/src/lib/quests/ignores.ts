/**
 * Lines this project has decided never to voice.
 *
 * The war-effort tallies read "$2113w", a counter the game expands against a live server, so
 * no take of them can ever be right. Quest 1 is Blizzard's own test quest. Neither is a text
 * defect an override could fix, and neither should sit in a search, a queue or the module.
 *
 * Keyed on lineId, unlike overrides.ts - see the header of migration 0017 for why a decision
 * about a line cannot be recorded against the file it happens to share with another.
 *
 * Read on every search, so it is memoised the way overrides are: whole table behind a
 * count-and-timestamp stamp, because there are tens of these rather than thousands and pm2
 * runs two workers that must not disagree about what is hidden.
 */
import { db } from "../db";

export type LineIgnore = {
  lineId: string;
  reason: string;
  createdAt: string;
  createdBy: string | null;
};

type IgnoreRow = {
  lineId: string;
  reason: string;
  createdAt: Date;
  createdBy: string | null;
};

function toIgnore(row: IgnoreRow): LineIgnore {
  return {
    lineId: row.lineId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

async function stamp(): Promise<string> {
  const { rows } = await db().query<{ stamp: string | null }>(
    `select count(*)::text || ':' || coalesce(max("createdAt")::text, '-') as stamp
       from "line_ignore"`,
  );
  // The count is load-bearing for the same reason it is in overrides.ts: un-ignoring a line
  // leaves max(createdAt) where it was, so a timestamp alone would keep hiding it.
  return rows[0]?.stamp ?? "-";
}

const cacheKey = Symbol.for("wow-voiceover.line-ignores");
type CacheHolder = { [cacheKey]?: { map: Map<string, LineIgnore>; stamp: string } };

/** Every ignored line, by lineId. */
export async function readIgnores(): Promise<Map<string, LineIgnore>> {
  const holder = globalThis as CacheHolder;
  const current = await stamp();
  if (holder[cacheKey]?.stamp === current) return holder[cacheKey].map;

  const { rows } = await db().query<IgnoreRow>(
    `select "lineId", "reason", "createdAt", "createdBy" from "line_ignore"`,
  );
  const map = new Map(rows.map((r) => [r.lineId, toIgnore(r)]));
  holder[cacheKey] = { map, stamp: current };
  return map;
}

export async function writeIgnore(
  lineId: string,
  reason: string,
  // Nullable to match the column, which is SET NULL: who decided outlives the account.
  userId: string | null,
): Promise<LineIgnore> {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("an ignore needs a reason: a decision nobody can revisit is a bug");

  const { rows } = await db().query<IgnoreRow>(
    `insert into "line_ignore" ("lineId", "reason", "createdBy")
     values ($1, $2, $3)
     on conflict ("lineId") do update
        set "reason" = excluded."reason",
            "createdAt" = now(),
            "createdBy" = excluded."createdBy"
     returning "lineId", "reason", "createdAt", "createdBy"`,
    [lineId, trimmed, userId],
  );
  forgetIgnores();
  return toIgnore(rows[0]);
}

export async function clearIgnore(lineId: string): Promise<boolean> {
  const { rowCount } = await db().query(`delete from "line_ignore" where "lineId" = $1`, [lineId]);
  forgetIgnores();
  return (rowCount ?? 0) > 0;
}

/**
 * Forget the memo after a write in this worker. Same race overrides.ts guards: `createdAt`
 * is `now()`, and a read inside the same transaction timestamp would see an unchanged stamp.
 */
export function forgetIgnores(): void {
  delete (globalThis as CacheHolder)[cacheKey];
}

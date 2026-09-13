/**
 * What this account has actually been charged, which is what estimates are calibrated from.
 *
 * Split out of billing.ts because that file's arithmetic is shared with the browser, and a
 * `pg` import anywhere in a client component's graph fails the production build with an
 * error neither pnpm test nor pnpm typecheck reports.
 */
import { db } from "@/lib/db";

import { CALIBRATION_SAMPLE, LIST_RATE, type Rate } from "./billing";

/**
 * The rate this account has actually been charged for a model, or the list rate.
 *
 * Per model, because the flash and turbo families are billed at half the others, and one
 * blended rate would be right for neither.
 */
export async function observedRate(modelId: string): Promise<Rate> {
  const { rows } = await db().query<{ characters: string | null; credits: string | null; n: string }>(
    `select sum("characters")::text as characters,
            sum("credits")::text    as credits,
            count(*)::text          as n
       from (
         select "characters", "credits"
           from "take"
          -- Both sides, deliberately: the rate being calibrated belongs to the plan, and
          -- which corpus was narrated to measure it does not change the next line's cost.
          where "modelId" = $1 and "credits" is not null and "characters" > 0
          order by "createdAt" desc
          limit ${CALIBRATION_SAMPLE}
       ) recent`,
    [modelId],
  );

  const row = rows[0];
  const characters = Number(row?.characters ?? 0);
  const credits = Number(row?.credits ?? 0);
  const samples = Number(row?.n ?? 0);

  // Summed rather than averaged per row: rounding to whole credits makes short lines noisy,
  // and one 20-character take rounding up would drag a per-row mean well off the true rate.
  if (!samples || !characters) return { rate: LIST_RATE, samples: 0, modelId };

  return { rate: credits / characters, samples, modelId };
}

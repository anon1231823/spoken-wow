/**
 * What a batch will cost, and what it did cost.
 *
 * ElevenLabs does not bill the characters you send. It bills round(characters * rate), and
 * the rate belongs to the plan rather than the request - 0.55 on the account this was built
 * against, and half that for the flash and turbo models, so a 310-character line cost 170.
 *
 * That rate cannot be read from the API and must not be hardcoded: it is a property of
 * someone's plan and discounts, and a constant here would quietly misprice every batch the
 * day either changes. So the rate is *learned* from what this account has actually been
 * charged, which the `character-cost` response header reports exactly.
 *
 * Until there is anything to learn from, estimates use 1 credit per character. That is the
 * documented list rate and an upper bound on every plan observed, which is the right
 * direction to be wrong in when the number is there to stop someone spending a month's
 * budget by accident.
 */
import { db } from "@/lib/db";

/** Credits per character before any plan discount. Deliberately pessimistic. */
export const LIST_RATE = 1;

/**
 * How many recent takes to calibrate from.
 *
 * Enough to survive one odd measurement, short enough that a plan change shows up within a
 * batch or two rather than being averaged away for months.
 */
export const CALIBRATION_SAMPLE = 50;

export type Rate = {
  /** Credits per character. */
  rate: number;
  /** How many past takes this came from. Zero means the fallback is in use. */
  samples: number;
  modelId: string | null;
};

/**
 * Round half to even, which is what ElevenLabs appears to do.
 *
 * Math.round would be wrong in both directions on a rate of 0.55, and the two cases that
 * pin it down disagree about which way "half" goes:
 *
 *    50 chars -> 27.5  -> billed 28   (half up, and half to even, both give 28)
 *   310 chars -> 170.5 -> billed 170  (half up gives 171; only half to even gives 170)
 *
 * Every measured pair fits this rule and no other simple one. It is still an inference from
 * a handful of observations rather than documented behaviour, and being one credit out on an
 * estimate costs nothing - the actual figure comes from the response header either way.
 */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function estimateCredits(characters: number, rate: number): number {
  return roundHalfToEven(characters * rate);
}

/**
 * The rate this account has actually been charged for a model, or the list rate.
 *
 * Per model, because the flash and turbo families are billed at half the others and mixing
 * them would produce a rate that is right for neither.
 */
export async function observedRate(modelId: string): Promise<Rate> {
  const { rows } = await db().query<{ characters: string | null; credits: string | null; n: string }>(
    `select sum("characters")::text as characters,
            sum("credits")::text    as credits,
            count(*)::text          as n
       from (
         select "characters", "credits"
           from "voiceline_version"
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

export type Estimate = {
  lines: number;
  /** Distinct audio files, which is what actually gets generated. */
  files: number;
  characters: number;
  credits: number;
  rate: Rate;
};

/**
 * Cost of regenerating a set of lines.
 *
 * Counts distinct files, not lines: 1,076 files in the corpus are spoken by more than one
 * NPC, so a naive per-line total would overstate a quest containing two lines that share an
 * mp3 - and the batch only generates each file once.
 */
export function estimate(
  lines: { characters: number; file: string }[],
  rate: Rate,
): Estimate {
  const byFile = new Map<string, number>();
  for (const line of lines) {
    if (!byFile.has(line.file)) byFile.set(line.file, line.characters);
  }

  const characters = [...byFile.values()].reduce((sum, count) => sum + count, 0);

  return {
    lines: lines.length,
    files: byFile.size,
    characters,
    credits: estimateCredits(characters, rate.rate),
    rate,
  };
}

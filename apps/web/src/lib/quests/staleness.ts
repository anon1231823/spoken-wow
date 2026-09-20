/**
 * Which files hold audio of text that has since changed.
 *
 * Migration 0006 already records the answer without knowing it: `spokenHash` is a sha-256 of
 * the exact string sent to ElevenLabs, written on every take since. Hash what would be sent
 * today and compare. Nothing read it until now.
 *
 * It catches more than an override. The hash moves when the regex rules in
 * voice/pronunciation.json change and when the corpus text does, so "this take predates the
 * current text" is answered for all three at once - which is the honest question anyway.
 *
 * A null hash is UNKNOWN, not unchanged, and is reported as fresh. Version 0 is audio this
 * project inherited and every take from before 0006 has no hash, so calling those stale would
 * mark most of the store on a claim nothing can support.
 */
import { fileIndex } from "../audio";
import { db } from "../db";
import { fileDefaults } from "../generation/files";
import { spokenHash } from "../generation/history";
import { accentTagged, audioTags } from "../generation/narration";
import { applyPronunciation } from "../generation/pronunciation";
import { currentConfig } from "../generation/settings";
import { readOverrides } from "./overrides";

/**
 * Of these files, the ones whose live take was made from different text.
 *
 * Takes the files rather than reading them all, because the caller usually has a page of
 * results and the answer for the other 17,000 lines is not wanted. Omitting them asks the
 * question of every take instead, which is what the "audio outdated" filter needs: a page's
 * worth of answers cannot narrow a search. That costs one query and a sha-256 per take, so it
 * is fetched only for the searches that read it, like the generation dates.
 */
export async function staleFiles(files?: string[]): Promise<Set<string>> {
  if (files?.length === 0) return new Set();

  const { rows } = files
    ? await db().query<{ file: string; spokenHash: string | null }>(
        `select "file", "spokenHash" from "take"
          where "source" = 'quests' and "isCurrent" and "file" = any($1::text[])`,
        [files],
      )
    : await db().query<{ file: string; spokenHash: string | null }>(
        `select "file", "spokenHash" from "take"
          where "source" = 'quests' and "isCurrent"`,
      );

  const overrides = await readOverrides();
  const lines = await fileIndex();
  const rules = fileDefaults().rules;
  // Once for the whole sweep, unlike regenerate.ts which reads it per line: this answers a
  // question about the takes as they stand, and a settings change landing mid-sweep would
  // only make half the answer describe a configuration that was never used to generate.
  const { raceTags } = await currentConfig();

  const stale = new Set<string>();
  for (const row of rows) {
    if (!row.spokenHash) continue;
    const line = lines.get(row.file);
    if (!line) continue;
    const text = overrides.get(row.file)?.text ?? line.text;
    // Same three transforms regenerate.ts applies, in the same order: the hash is of the
    // string that was sent, so a take of "[hic]" must be compared against "[hic]" and not
    // "<hic>", and a dwarf take made with its accent direction against that same direction -
    // otherwise every dwarf line reads as stale forever rather than once.
    const spoken = accentTagged(audioTags(applyPronunciation(text, rules)), raceTags[line.race]);
    if (spokenHash(spoken) !== row.spokenHash) {
      stale.add(row.file);
    }
  }
  return stale;
}

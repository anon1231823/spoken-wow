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
import { applyPronunciation } from "../generation/pronunciation";
import { readOverrides } from "./overrides";

/**
 * Of these files, the ones whose live take was made from different text.
 *
 * Takes the files rather than reading them all, because the caller has a page of results and
 * the answer for the other 17,000 lines is not wanted.
 */
export async function staleFiles(files: string[]): Promise<Set<string>> {
  if (files.length === 0) return new Set();

  const { rows } = await db().query<{ file: string; spokenHash: string | null }>(
    `select "file", "spokenHash" from "voiceline_version"
      where "isCurrent" and "file" = any($1::text[])`,
    [files],
  );

  const overrides = await readOverrides();
  const lines = fileIndex();
  const rules = fileDefaults().rules;

  const stale = new Set<string>();
  for (const row of rows) {
    if (!row.spokenHash) continue;
    const line = lines.get(row.file);
    if (!line) continue;
    const text = overrides.get(row.file)?.text ?? line.text;
    if (spokenHash(applyPronunciation(text, rules)) !== row.spokenHash) stale.add(row.file);
  }
  return stale;
}

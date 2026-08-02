import { NextResponse } from "next/server";

import { requireConfigure } from "@/lib/authz";
import { catalogue, invalidateCatalogue } from "@/lib/catalogue";
import { loadManifest, loadPronunciation, savePronunciation, textHash, toSpokenText } from "@/lib/tools";

// tools/voice/pronunciation.json, read and written.
//
// The point of the page this serves is that a rule is not free: it changes the spoken
// text, which changes the hash, which marks every line it touches stale and therefore
// due for a paid regeneration. So both GET and POST report how many lines a rule set
// affects and what that would cost in staleness, before it is saved.

type Impact = {
  /** Rule -> how many lines contain that word at all. */
  matches: Record<string, number>;
  /** Lines whose spoken text would differ from what their live take was made from. */
  staleAfter: number;
  /** Lines already stale now, so the delta is attributable to the edit. */
  staleNow: number;
  totalLines: number;
};

async function impactOf(rules: Record<string, string>): Promise<Impact> {
  const [entries, manifest] = await Promise.all([catalogue(), loadManifest()]);

  const matches: Record<string, number> = {};
  for (const from of Object.keys(rules)) matches[from] = 0;

  let staleAfter = 0;
  let staleNow = 0;

  for (const entry of entries) {
    for (const from of Object.keys(rules)) {
      // Whole words, matching toSpokenText's own substitution, so the count means
      // "lines this rule would actually change".
      if (new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(entry.full)) {
        matches[from]++;
      }
    }

    const take = manifest[entry.id];
    if (!take) continue;

    // entry.hash reflects the rules currently on disk; the second is what the rules
    // being previewed would produce.
    if (take.textHash !== entry.hash) staleNow++;
    if (take.textHash !== textHash(toSpokenText(entry.full, rules))) staleAfter++;
  }

  return { matches, staleAfter, staleNow, totalLines: entries.length };
}

// Admins only, on both verbs. GET is guarded as well as POST because it is the editor's
// data source and not a public one -- and because impactOf() walks 1353 entries and hashes
// each one, which is not a computation to leave open to anyone who asks.
export async function GET() {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  const rules = await loadPronunciation();
  return NextResponse.json({ rules, impact: await impactOf(rules) });
}

export async function POST(request: Request) {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    rules?: unknown;
    preview?: unknown;
  };

  const rules = body.rules;
  if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
    return NextResponse.json({ error: "rules must be an object" }, { status: 400 });
  }
  for (const [from, to] of Object.entries(rules)) {
    if (typeof to !== "string") {
      return NextResponse.json({ error: `rule "${from}" must map to a string` }, { status: 400 });
    }
    if (from.trim() === "") {
      return NextResponse.json({ error: "a rule cannot have an empty word" }, { status: 400 });
    }
  }

  const typed = rules as Record<string, string>;

  // Preview is what makes this safe to experiment with: see what a rule would do to
  // 1353 lines before writing anything, since saving is what marks them stale.
  if (body.preview) {
    return NextResponse.json({ rules: typed, impact: await impactOf(typed) });
  }

  await savePronunciation(typed);
  // Before impactOf, so it reports against a catalogue rebuilt with the new rules and
  // staleNow becomes what the explorer will actually show.
  invalidateCatalogue();

  return NextResponse.json({ rules: typed, impact: await impactOf(typed), saved: true });
}

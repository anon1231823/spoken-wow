import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ContributionTable, { type ContributionRow } from "@/components/ContributionTable";
import { auth } from "@/lib/auth";
import { pageById } from "@/lib/books/catalogue";
import { corpusLookup } from "@/lib/contributions/existing";
import { isStatus, type ContributionStatus } from "@/lib/contributions/contributions";
import { listContributions, type Contribution } from "@/lib/contributions/store";
import { npcSummaryFrom, questFor, type NpcSummary } from "@/lib/contributions/triage";
import { facets } from "@/lib/facets";
import { observedFrom, resolveNpc } from "@/lib/npc/resolve";
import { isProvenance, getResolutions, resolutionKey, type NpcKind, type Provenance } from "@/lib/npc/store";
import { canRegenerate } from "@/lib/permissions";
import { lineByPath } from "@/lib/zones/catalogue";

export const metadata: Metadata = { title: "Contributions · Spoken" };

// A triage queue read against a database that other people are also resolving rows in.
export const dynamic = "force-dynamic";

/**
 * The corpus text a contribution's key already resolves to, or undefined where it does not.
 *
 * Only books and zones have a key corpusLookup can resolve (see existing.ts); a quests row is
 * left out of the map entirely rather than looked up and always missing, so the table can
 * tell "not checked" apart from "checked and the corpus has nothing".
 */
async function existingTextFor(contributions: Contribution[]): Promise<Record<number, string>> {
  const found: Record<number, string> = {};

  await Promise.all(
    contributions.map(async (row) => {
      const lookup = corpusLookup(row.source, row.key);
      if (!lookup) return;

      if (lookup.source === "books") {
        const page = await pageById(lookup.pageId);
        if (page) found[row.id] = page.text;
      } else {
        const line = await lineByPath(lookup.mapID, lookup.slug);
        if (line) found[row.id] = line.full;
      }
    }),
  );

  return found;
}

/**
 * Who the corpus, the client or a moderator believes each row's NPC to be.
 *
 * Keyed on the contribution id, not the (kind, id) pair, because that is what the table already
 * indexes rows by; the underlying resolution is still shared across every contribution that
 * names the same NPC, which is the whole point of resolveNpc writing through to it.
 *
 * A row present with `npc` set but every field null is meaningful, not absent: it says a
 * moderator or the resolver looked and found no race to assign (a narrator, say). Absent
 * entirely means the envelope never named an NPC at all -- zones and books never do, and a
 * quests envelope keyed on quest+event rather than npc doesn't either.
 */
async function npcFor(contributions: Contribution[]): Promise<Record<number, NpcSummary>> {
  const found: Record<number, NpcSummary> = {};

  // build is its own column on a stored contribution, not part of `meta` (submissionFrom
  // strips it out at intake) -- put back for observedFrom the way the intake route and the
  // export do, even though this function only reads npcKind/npcId off the result.
  const observed = contributions.map((row) => ({
    row,
    observed: observedFrom({ ...row.meta, build: row.build }),
  }));

  // One query for every row's NPC, not one per row -- getResolutions is exactly what the
  // export already uses to do this, and a per-row getResolution here used to mean the whole
  // moderator queue issued one round trip per contribution (and, worse, that any single
  // poisoned npcId -- see resolve.ts's digits() -- would throw inside this Promise.all and
  // 500 the entire page).
  const keys: { npcKind: NpcKind; npcId: number }[] = [];
  for (const { observed: o } of observed) {
    if (o.npcKind !== null && o.npcId !== null) keys.push({ npcKind: o.npcKind, npcId: o.npcId });
  }
  const resolutions = await getResolutions(keys);

  // An NPC the batch read found nothing for is still resolvable, not merely displayable: an
  // envelope this old predates resolveNpc being called at intake at all (the three real rows
  // this table was designed against are exactly this -- filed before the addon reported `kind`
  // or `model`). Resolving them now, once, is what lets a corpus hit surface instead of a blank
  // "none" forever, and it persists a row a moderator's override can then rank against. Kept off
  // the path entirely for a key already in `resolutions` -- resolveNpc would just re-read that
  // same row back, and a row already answered (not least a moderator's own) must never be
  // touched here. Deduplicated by key first: two of the three real rows name the same NPC, and
  // without this, resolving them in the same Promise.all would race two upserts for one row.
  const toResolve = new Map<string, (typeof observed)[number]["observed"]>();
  for (const { observed: o } of observed) {
    if (o.npcKind === null || o.npcId === null) continue;
    const key = resolutionKey(o.npcKind, o.npcId);
    if (!resolutions.has(key) && !toResolve.has(key)) toResolve.set(key, o);
  }
  const newlyResolved = await Promise.all(
    [...toResolve.entries()].map(async ([key, o]) => [key, await resolveNpc(o)] as const),
  );
  for (const [key, resolution] of newlyResolved) {
    if (resolution) resolutions.set(key, resolution);
  }

  for (const { row, observed: o } of observed) {
    // No npc named at all -- zones, books, or a quest keyed on quest+event -- is the one case
    // with nothing to show; a kind-less envelope (o.npcKind === null) still has an id and a
    // name and gets a summary too, npcSummaryFrom's own reason for allowing a null npcKind.
    if (o.npcId === null) continue;

    // A kind-less observation can never itself be a key into `resolutions` (getResolutions and
    // the resolve loop above both require a kind), so there is nothing to look up for it here --
    // only a resolution recorded under this envelope's own kind counts.
    const resolution = o.npcKind !== null ? resolutions.get(resolutionKey(o.npcKind, o.npcId)) : undefined;
    found[row.id] = await npcSummaryFrom({ npcKind: o.npcKind, npcId: o.npcId, npcName: o.npcName }, resolution);
  }

  return found;
}

/** /contributions's second filter dimension: whether the row's NPC is a settled answer. */
export type ConfirmedFilter = "confirmed" | "unconfirmed" | "all";

function isConfirmedFilter(value: unknown): value is "confirmed" | "unconfirmed" {
  return value === "confirmed" || value === "unconfirmed";
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; provenance?: string; confirmed?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  // 404, matching /reports: a member has no business learning the page exists, and these
  // rows hold text and identifying details a stranger pasted in.
  if (!session || !canRegenerate(session.user.role)) notFound();

  const { status: rawStatus, provenance: rawProvenance, confirmed: rawConfirmed } = await searchParams;
  const status: ContributionStatus | "all" = isStatus(rawStatus)
    ? rawStatus
    : rawStatus === "all"
      ? "all"
      : "new";
  // Both default to "all": these are what makes an unconfirmed NPC revisitable later (the
  // feature the spec asked for and this branch had left unbuilt -- see finding 5), not a
  // narrowing anyone needs applied before they ask for it.
  const provenance: Provenance | "all" = isProvenance(rawProvenance) ? rawProvenance : "all";
  const confirmed: ConfirmedFilter = isConfirmedFilter(rawConfirmed) ? rawConfirmed : "all";

  const contributions = await listContributions(status);
  const existing = await existingTextFor(contributions);
  const npcs = await npcFor(contributions);

  // ContributionTable is a client component: whatever shape crosses in `initial` lands in the
  // RSC flight payload and is readable in devtools, so the full row -- name, email, raw, the
  // ip listContributions doesn't even select -- never leaves this server function. `body` is
  // the one identifying-adjacent field that does cross, deliberately: see finding 4/the
  // table's own docstring for why a player's complaint belongs where triage can read it.
  const rows: ContributionRow[] = contributions
    .map((row) => ({
      id: row.id,
      source: row.source,
      key: row.key,
      locale: row.locale,
      count: row.count,
      text: row.text,
      status: row.status,
      createdAt: row.createdAt,
      body: row.body,
      npc: npcs[row.id] ?? null,
      quest: questFor(row),
    }))
    // A row with no npc at all has nothing for either filter to match -- neither filter is
    // "which rows never named an NPC", so it drops out the moment either one narrows anything,
    // rather than showing up under an "unconfirmed" or a specific-provenance view it was never
    // part of.
    .filter((row) => {
      if (provenance === "all" && confirmed === "all") return true;
      if (!row.npc) return false;
      if (provenance !== "all" && row.npc.provenance !== provenance) return false;
      if (confirmed !== "all" && row.npc.confirmed !== (confirmed === "confirmed")) return false;
      return true;
    });

  const facetValues = await facets();

  return (
    <main className="mx-auto max-w-6xl px-5 pt-6 pb-24">
      <h1 className="text-xl font-semibold">Contributions</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Envelopes players pasted in for text this corpus has no audio for. Accepting a row does
        not queue anything -- it only marks the row for the next export, which the pipelines
        pull on their own schedule.
      </p>

      <ContributionTable
        initial={rows}
        status={status}
        provenance={provenance}
        confirmed={confirmed}
        existing={existing}
        raceOptions={facetValues.races}
        genderOptions={facetValues.genders}
        flavorScopes={facetValues.flavorScopes}
      />
    </main>
  );
}

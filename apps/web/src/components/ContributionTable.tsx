"use client";

/**
 * The triage list for pasted envelopes.
 *
 * A table for the same reason ReportTable is one: triage is a scan down a column, and the
 * submitted text -- which can run to a full quest's worth of dialogue -- sits behind a
 * `<details>` so a long paste does not push every row after it off the screen (the reasoning
 * CATEGORY_COLUMN gives in lib/reports/reports.ts for the same shape of problem).
 *
 * Never renders `ip`, `name` or `email`: reports/ReportTable shows a reporter's own name
 * because they gave it to have their report followed up on, but a contribution's identifying
 * fields exist only for abuse response, not for triage to read. `body` -- the optional
 * complaint -- is different: it's the one field a player filled in specifically to be read,
 * so it is rendered below, deliberately included in the Row this component accepts.
 *
 * `initial` is typed as `ContributionRow`, not the full `Contribution`, and page.tsx must
 * project down to it before passing rows here: this is a "use client" component, so whatever
 * shape its props carry crosses into the RSC flight payload and is readable in devtools
 * regardless of what this file goes on to render. `ip`, `name`, `email` and `raw` have no
 * reason to make that crossing at all.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import { CLIENT_FAMILIES, CLIENT_FAMILY_LABELS, type ClientSummary } from "@/lib/contributions/client";
import { contributionsHref, NEEDS_DECISION, type ClientFilter, type SpeakerFilter } from "@/lib/contributions/query";
import type { Contribution } from "@/lib/contributions/store";
// Both are computed server-side (npcSummaryFrom pulls in corpus.ts's flavorsFor) -- `import
// type` erases the whole thing at compile time, so none of that follows the type in here. The
// same split existing.ts's `existing` prop already draws.
import type { NpcConflictOption, NpcSummary, QuestSummary } from "@/lib/contributions/triage";
// From npc.ts, not npc/store.ts: store.ts imports @/lib/db, and pulling NPC_KINDS/PROVENANCES
// (values, not just types) out of it would drag Postgres's own node built-ins into this bundle.
import { NPC_KINDS, PROVENANCES, type NpcKind, type Provenance } from "@/lib/npc/npc";
import type { NpcResolution } from "@/lib/npc/store";
import { wowheadEntityUrl, wowheadForeverUrl, wowheadQuestUrl } from "@/lib/wowhead";

export type { NpcSummary };

/** The fields this table reads. page.tsx projects full Contribution rows down to this shape. */
export type ContributionRow = Pick<
  Contribution,
  "id" | "source" | "key" | "locale" | "count" | "text" | "status" | "createdAt" | "body"
> & {
  /** The game client the text came from, classified from the envelope's `build`. */
  client: ClientSummary;
  /** Null when the envelope never named an NPC at all -- zones and books, or a quest keyed on quest+event. */
  npc: NpcSummary | null;
  /** Null when the source has no quest concept at all. See lib/contributions/triage.ts. */
  quest: QuestSummary | null;
  /**
   * Whether this contribution's line is already in the explorer (accept.ts's lineIsInExplorer).
   * Only meaningful for an accepted quests row -- it is what decides whether "Add to explorer"
   * is offered: a row accepted before this feature existed has none yet.
   */
  hasLine: boolean;
};

/** A race-gender-flavor triple the corpus actually has, for the "nothing known" state's selects. */
type FlavorScope = { race: string; gender: string; flavor: string };

const SOURCE_LABELS: Record<Contribution["source"], string> = {
  quests: "Quests",
  zones: "Zones",
  books: "Books",
};

const STATUS_LABELS: Record<ContributionStatus, string> = {
  new: "New",
  accepted: "Accepted",
  rejected: "Rejected",
};

const STATUS_OPTIONS: readonly ContributionStatus[] = ["new", "accepted", "rejected"];
const STATUS_CHIP_OPTIONS: ChipOption[] = STATUS_OPTIONS.map((option) => ({
  value: option,
  label: STATUS_LABELS[option],
}));

const PROVENANCE_LABELS: Record<Provenance, string> = {
  corpus: "Corpus",
  client: "Client guess",
  moderator: "Moderator",
  none: "No race",
};

// The Speaker dropdown's options: NEEDS_DECISION first -- it's the view this queue exists for,
// "everything nobody has settled yet" -- then PROVENANCES's own four, unchanged. "Confirmed"
// (the union nobody triages: settled rows) is deliberately not here; see NEEDS_DECISION's own
// docstring in lib/contributions/query.ts for why that one dropped out while this one didn't.
const SPEAKER_CHIP_OPTIONS: ChipOption[] = [
  { value: NEEDS_DECISION, label: "Needs a decision" },
  ...PROVENANCES.map((option) => ({ value: option, label: PROVENANCE_LABELS[option] })),
];

const CLIENT_CHIP_OPTIONS: ChipOption[] = CLIENT_FAMILIES.map((option) => ({
  value: option,
  label: CLIENT_FAMILY_LABELS[option],
}));

/** The day and the clock time, short enough to sit in a column, matching ReportTable's `when`. */
function when(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "race-gender-flavor", or as much of it as is known -- a moderator can fill in the rest. */
function speaker(npc: NpcSummary): string {
  return [npc.race, npc.gender, npc.flavor].map((part) => part ?? "?").join("-");
}

/**
 * A row's speaker column must never read as a confident answer when it isn't one: `confirmed`
 * is the one column resolveNpc and the override route agree means "trust this", so it -- not
 * provenance alone -- is what this table shows plainly versus flags.
 *
 * A confirmed row with every field null is still a decision, not an absence -- a moderator (or
 * the corpus, for a narrator-style pseudo-race) looked and there is no race to assign. Left
 * unlabelled, "?-?-?" next to a "moderator" badge would be one small badge away from looking
 * identical to a genuinely unresolved "?-?-?"/"none" row, which defeats the point of this column
 * being a skimmable "still needs a human" signal.
 *
 * Null (no note at all) for an unconfirmed row with no provenance opinion: the nothing-known
 * form rendered right below already says "nobody has answered this" as plainly as a caption
 * could -- a redundant "not identified" used to sit here saying the same thing a third time,
 * after the missing provenance badge (see the `none` branch below) already dropped it once.
 */
function speakerNote(npc: NpcSummary): string | null {
  if (npc.confirmed) {
    return npc.race || npc.gender || npc.flavor ? null : "confirmed: no race";
  }
  return null;
}

export default function ContributionTable({
  initial,
  status,
  provenance,
  client,
  existing,
  raceOptions,
  genderOptions,
  flavorScopes,
}: {
  initial: ContributionRow[];
  status: ContributionStatus | "all";
  provenance: SpeakerFilter;
  client: ClientFilter;
  /** id -> corpus text, present only where the row's key resolves to something on file. */
  existing: Record<number, string>;
  /** facets().races/genders -- every race and gender the corpus has, for the "nothing known" state's selects. */
  raceOptions: string[];
  genderOptions: string[];
  /** facets().flavorScopes -- what lets that state's flavor select narrow to whatever race-gender was just chosen, without a round trip. */
  flavorScopes: FlavorScope[];
}) {
  const router = useRouter();

  /**
   * What this session resolved, overlaid on the server's rows -- the same shape ReportTable
   * uses and for the same reason: the status dropdown below is a navigation, so seeding state
   * from `initial` once would leave a resolved row sitting in a queue it no longer belongs to
   * until the next reload.
   */
  const [resolved, setResolved] = useState<Record<number, Contribution["status"]>>({});
  const [busy, setBusy] = useState<number | null>(null);
  /** Same overlay idea as `resolved`, for "Add to explorer" succeeding on an already-accepted row. */
  const [lineCreated, setLineCreated] = useState<Set<number>>(new Set());
  /** A refused resolve, in the words the route already gives -- cleared by the next attempt. */
  const [refusals, setRefusals] = useState<Record<number, string>>({});

  /**
   * The npc column, overlaid on the server's rows for the same reason `resolved` is: the
   * override writes through to the NPC, not this contribution, so nothing here navigates away
   * on save and a reload would be the only other way to see it land.
   */
  const [npcOverrides, setNpcOverrides] = useState<Record<number, NpcSummary>>({});
  const [npcBusy, setNpcBusy] = useState<number | null>(null);

  const overrideNpc = useCallback(
    async (
      contributionId: number,
      npc: NpcSummary,
      // Partial on purpose -- a key left out entirely (not sent as "") tells the route to keep
      // whatever is already on the row, which is what lets the "client" state save just a
      // flavor and the "nothing known" state save just a race and gender. See the route's own
      // orExisting for the other half of this. `npcKind` is only ever in here for a kind-less
      // row (npc.npcKind === null): the moderator's own select is the only source for it then,
      // since there is no existing row (or envelope) to fall back on the way race/gender/flavor
      // can.
      answer: Partial<{ npcKind: NpcKind; race: string; gender: string; flavor: string; note: string }>,
    ) => {
      setNpcBusy(contributionId);
      const response = await fetch("/api/contributions/npc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `...answer` last: its own npcKind (a kind-less row's moderator-chosen one) overrides
        // the default, and is absent -- so has no effect -- for every other row.
        body: JSON.stringify({ npcId: npc.npcId, npcKind: npc.npcKind, ...answer }),
      }).catch(() => null);
      setNpcBusy(null);

      if (!response?.ok) return;
      const { resolution } = (await response.json()) as { resolution: NpcResolution };
      // A kind-less row's moderator just said which kind it is: record that on the contribution
      // too, so a later answer for the other kind under the same id can never turn this row
      // into a conflict.
      if (npc.npcKind === null && answer.npcKind) {
        await recordKind(contributionId, answer.npcKind);
      }
      setNpcOverrides((current) => ({
        ...current,
        [contributionId]: {
          npcKind: resolution.npcKind,
          npcId: resolution.npcId,
          npcName: resolution.npcName,
          race: resolution.race,
          gender: resolution.gender,
          flavor: resolution.flavor,
          provenance: resolution.provenance,
          confirmed: resolution.confirmed,
          // A saved answer is always "settled" (provenance "moderator" is always confirmed --
          // migration 0031), so nothing here ever renders the flavor select again to need
          // these -- computed anyway so the type stays honest rather than lying with `[]`.
          flavorOptions:
            resolution.race && resolution.gender
              ? flavorScopes
                  .filter((scope) => scope.race === resolution.race && scope.gender === resolution.gender)
                  .map((scope) => scope.flavor)
              : [],
          conflict: [],
        },
      }));
    },
    [flavorScopes],
  );

  /**
   * A conflict settled: the moderator picked which of the answers on file this contribution's
   * NPC is. Recorded on the contribution (api/contributions/kind), then shown as that answer.
   */
  const pickConflict = useCallback(
    async (contributionId: number, npc: NpcSummary, option: NpcConflictOption) => {
      setNpcBusy(contributionId);
      const ok = await recordKind(contributionId, option.npcKind);
      setNpcBusy(null);
      if (!ok) {
        setRefusals((current) => ({ ...current, [contributionId]: "That didn't go through -- try again." }));
        return;
      }
      setNpcOverrides((current) => ({
        ...current,
        [contributionId]: {
          ...npc,
          npcKind: option.npcKind,
          race: option.race,
          gender: option.gender,
          flavor: option.flavor,
          provenance: option.provenance,
          confirmed: option.provenance === "corpus" || option.provenance === "moderator",
          flavorOptions:
            option.race && option.gender
              ? flavorScopes
                  .filter((scope) => scope.race === option.race && scope.gender === option.gender)
                  .map((scope) => scope.flavor)
              : [],
          conflict: [],
        },
      }));
    },
    [flavorScopes],
  );

  const resolve = useCallback(async (id: number, next: ContributionStatus) => {
    setBusy(id);
    const response = await fetch("/api/contributions/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    }).catch(() => null);
    setBusy(null);

    if (!response?.ok) {
      // The route already gives a plain-words reason for needs-speaker and one-way (accept.ts);
      // anything else (bad status, unknown row) degrades the same way this always has.
      const body = await response?.json().catch(() => null);
      setRefusals((current) => ({
        ...current,
        [id]: typeof body?.error === "string" ? body.error : "That didn't go through -- try again.",
      }));
      return;
    }
    setRefusals((current) => {
      if (!(id in current)) return current;
      const { [id]: _dropped, ...rest } = current;
      return rest;
    });
    setResolved((current) => ({ ...current, [id]: next }));
    // "Add to explorer" is the same POST as Accept, re-sent for a row already accepted -- this
    // is what hides the button once it has worked, without waiting for a reload.
    if (next === "accepted") setLineCreated((current) => new Set(current).add(id));
  }, []);

  const rows = initial.filter((row) => {
    const current = resolved[row.id] ?? row.status;
    return status === "all" || current === status;
  });

  /**
   * Move one dropdown and keep the other, then push it -- a soft navigation, not a state
   * change, so the filter still lives in the URL and survives a refresh. Follows
   * ReportTable.tsx's own `go`; the mapping itself is contributionsHref, pulled out to
   * lib/contributions/query.ts so it can be tested without rendering FilterChip or this table.
   */
  function go(next: { status?: ContributionStatus | "all"; provenance?: SpeakerFilter; client?: ClientFilter }) {
    router.push(contributionsHref({ status, provenance, client }, next));
  }

  return (
    <>
      {/* Dropdowns, the same control the explorers filter with -- matching ReportTable.
          Status/Speaker being one dropdown each, rather than a row of link pills, is what makes
          "New / Accepted / Rejected / All" and the six speaker pills fit without crowding. */}
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip
          label="status"
          value={status === "all" ? undefined : status}
          options={STATUS_CHIP_OPTIONS}
          onChange={(next) => go({ status: next as ContributionStatus | undefined })}
        />
        <FilterChip
          label="speaker"
          value={provenance === "all" ? undefined : provenance}
          options={SPEAKER_CHIP_OPTIONS}
          onChange={(next) => go({ provenance: next as SpeakerFilter | undefined })}
        />
        <FilterChip
          label="client"
          value={client === "all" ? undefined : client}
          options={CLIENT_CHIP_OPTIONS}
          onChange={(next) => go({ client: next as ClientFilter | undefined })}
        />
      </nav>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-3 font-normal">Filed</th>
              <th className="border-b py-2 pr-3 font-normal">Source</th>
              <th className="border-b py-2 pr-3 font-normal">NPC</th>
              <th className="border-b py-2 pr-3 font-normal">Quest</th>
              <th className="border-b py-2 pr-3 font-normal">Client</th>
              <th className="border-b py-2 pr-3 font-normal">Count</th>
              <th className="border-b py-2 pr-3 font-normal">What they sent</th>
              <th className="border-b py-2 pr-3 font-normal">Status</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const current = resolved[row.id] ?? row.status;
              const found = existing[row.id];
              const npc = npcOverrides[row.id] ?? row.npc;

              return (
                // Top-aligned, not middle: the NPC/Speaker cell below can grow to a whole form's
                // height (race/gender/flavor selects, a note input), and centring every other
                // cell against that made the short ones float to mid-row instead of sitting on
                // a scannable line.
                <tr
                  key={row.id}
                  // Anchor, not just a key: an accepted quests row's line carries a link back
                  // here (LineRow.tsx's "contributed" badge), and this is what it jumps to.
                  id={`contribution-${row.id}`}
                  className="align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5"
                >
                  <td className="text-muted-foreground pr-3 text-xs whitespace-nowrap">
                    {when(row.createdAt)}
                  </td>

                  <td className="pr-3 text-xs whitespace-nowrap">
                    {/* The raw triage key moved here, as a hover title -- the NPC and Quest
                        columns are what a moderator scans now (finding 1), but the key is still
                        worth having for a zones/books row, where neither column applies. */}
                    <Badge variant="outline" className="py-0 leading-5" title={row.key}>
                      {SOURCE_LABELS[row.source]}
                    </Badge>
                  </td>

                  {/* NPC and Speaker, merged: who the NPC is and who voices their lines are the
                      same question, and showing them as two columns meant scanning across the
                      row to connect an id in one cell with a form three cells later. Name/id/
                      links stay on their own line; the voice -- settled text for a corpus NPC,
                      the override form for one that isn't -- sits right beneath it. */}
                  <td className="max-w-[20rem] pr-3 text-xs">
                    {npc ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <a
                            href={`/quests?q=${npc.npcId}&filter=npc`}
                            className="truncate hover:underline"
                            title={npc.npcName ?? undefined}
                          >
                            {npc.npcName ?? "unnamed"}{" "}
                            <span className="text-muted-foreground">#{npc.npcId}</span>
                          </a>
                          <a
                            href={
                              // The corpus's own exact answer means it has this NPC on the branch
                              // the corpus is built from; anything else -- including a post-vanilla
                              // NPC like 205729 -- is only ever on the client's own branch. See
                              // wowhead.ts for why two branches exist rather than one.
                              //
                              // A kind-less row (npc.npcKind === null) has no real kind to link
                              // with yet -- "creature" is a convenience guess for this link only,
                              // never stored, and every quest/gossip npc field this table has ever
                              // seen has in fact named one.
                              npc.provenance === "corpus"
                                ? wowheadEntityUrl(npc.npcKind ?? "creature", npc.npcId)
                                : wowheadForeverUrl(npc.npcKind ?? "creature", npc.npcId)
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground shrink-0 hover:underline"
                          >
                            wh↗
                          </a>
                        </div>
                        {npc.conflict.length > 0 ? (
                          <NpcConflict
                            npc={npc}
                            busy={npcBusy === row.id}
                            onPick={(option) => void pickConflict(row.id, npc, option)}
                          />
                        ) : (
                          <SpeakerCell
                            npc={npc}
                            raceOptions={raceOptions}
                            genderOptions={genderOptions}
                            flavorScopes={flavorScopes}
                            busy={npcBusy === row.id}
                            onSave={(answer) => void overrideNpc(row.id, npc, answer)}
                          />
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  <td className="max-w-[14rem] pr-3 text-xs whitespace-nowrap">
                    {row.quest === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : row.quest === "gossip" ? (
                      "Gossip"
                    ) : (
                      <>
                        <span className="truncate">{row.quest.title}</span>{" "}
                        <a
                          href={wowheadQuestUrl(row.quest.questId)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:underline"
                        >
                          #{row.quest.questId}
                        </a>
                      </>
                    )}
                  </td>

                  {/* Which game, then the locale and the exact build underneath: the version is
                      in the label, and the build number is what tells a beta's builds apart. */}
                  <td className="pr-3 text-xs whitespace-nowrap">
                    <div>{row.client.label}</div>
                    <div className="text-muted-foreground">
                      {row.locale}
                      {row.client.buildNumber ? ` · ${row.client.buildNumber}` : null}
                    </div>
                  </td>

                  <td className="pr-3 text-xs whitespace-nowrap">{row.count}</td>

                  <td className="max-w-md pr-3">
                    {/* Collapsed by default: a full quest's dialogue in an open cell is the
                        "table stops being a scan" failure this markup exists to avoid. */}
                    <details>
                      <summary className="text-muted-foreground cursor-pointer text-xs">
                        {row.text ? `${row.text.length} chars` : "no text"}
                        {found !== undefined ? " · corpus already has this key" : ""}
                        {row.body ? " · note attached" : ""}
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap">{row.text ?? "(no text sent)"}</p>
                      {row.body ? (
                        // The optional complaint: collected on the form, stored as `body`, and
                        // until now rendered nowhere -- a player who explained what was wrong
                        // had that reach no one. Shown here rather than its own column because
                        // most rows won't have one and a column that's usually empty is a scan
                        // slower than the details cell it would sit next to.
                        <div className="mt-2 rounded border p-2">
                          <p className="text-muted-foreground text-xs font-medium">
                            What they said was wrong:
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">{row.body}</p>
                        </div>
                      ) : null}
                      {found !== undefined ? (
                        // A "missing" key the corpus already answers to is a corpus bug, not
                        // an absent line -- shown beside the submitted text so that reading is
                        // a glance, not a second lookup.
                        <div className="bg-muted/40 mt-2 rounded p-2">
                          <p className="text-muted-foreground text-xs font-medium">
                            Already on file:
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">{found}</p>
                        </div>
                      ) : null}
                    </details>
                  </td>

                  <td className="pr-3 text-xs whitespace-nowrap">{STATUS_LABELS[current]}</td>

                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {current !== "accepted" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === row.id}
                          onClick={() => void resolve(row.id, "accepted")}
                        >
                          Accept
                        </Button>
                      ) : row.source === "quests" && !(row.hasLine || lineCreated.has(row.id)) ? (
                        // A quests row accepted before this feature existed (or reopened and
                        // re-accepted since) has no line in the quest tables yet -- Accept itself is
                        // hidden once `current` is already "accepted", so this is the only way
                        // back to the same POST, still gated by resolveContribution's own rules
                        // (needs-speaker, collision, one-way).
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === row.id}
                          onClick={() => void resolve(row.id, "accepted")}
                        >
                          Add to explorer
                        </Button>
                      ) : null}
                      {current !== "rejected" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === row.id}
                          onClick={() => void resolve(row.id, "rejected")}
                        >
                          Reject
                        </Button>
                      ) : null}
                      {current !== "new" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === row.id}
                          onClick={() => void resolve(row.id, "new")}
                        >
                          Reopen
                        </Button>
                      ) : null}
                    </div>
                    {refusals[row.id] ? (
                      // Plain words, straight from resolveContribution's own refusal message --
                      // silence here used to be the whole failure mode ("Degrade per row on a
                      // failed resolve"), and a moderator staring at a button that visibly did
                      // nothing has no way to tell "try again" from "fix something first".
                      <p className="text-destructive mt-1 text-right text-xs">{refusals[row.id]}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Record a kind-less contribution's NPC kind (api/contributions/kind). True when it landed. */
async function recordKind(contributionId: number, npcKind: NpcKind): Promise<boolean> {
  const response = await fetch("/api/contributions/kind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: contributionId, npcKind }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

/**
 * A kind-less row whose id has disagreeing answers on file -- one as a creature, another as a
 * gameobject. Each is shown with where it came from; the moderator picks the one this
 * contribution meant, and nothing is used until they do (triage.ts's idOnlyResolution).
 */
function NpcConflict({
  npc,
  busy,
  onPick,
}: {
  npc: NpcSummary;
  busy: boolean;
  onPick: (option: NpcConflictOption) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-destructive">Conflicting answers for #{npc.npcId} -- which is it?</p>
      {npc.conflict.map((option) => (
        <div key={option.npcKind} className="flex items-center gap-2">
          <span>
            {option.npcKind}: {[option.race, option.gender, option.flavor].filter(Boolean).join("-") || "no race"}
          </span>
          <Badge variant="outline" className="py-0 leading-5">
            {option.provenance}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={() => onPick(option)}
          >
            This one
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * The voice line of the merged NPC/Speaker column (finding 4), in the three states finding 2
 * asks for -- keyed on `confirmed`, not
 * `provenance` alone, for the reason speakerNote already draws that distinction: `confirmed` is
 * the column resolveNpc and the override route agree means "trust this" (migration 0031 only
 * ever sets it for "corpus" or "moderator"), so a moderator's own settled answer gets the same
 * plain, uncontrolled rendering the corpus's does -- there is nothing left to decide either way,
 * and re-opening one would need a distinct "reopen" affordance this table does not yet have.
 *
 *   - confirmed (corpus or moderator): plain text, no controls.
 *   - unconfirmed, race and gender known ("client"): race-gender as text, a flavor select
 *     narrowed to flavorsFor(race, gender) -- npc.flavorOptions, computed server-side.
 *   - unconfirmed, nothing known ("none"): race and gender selects from the corpus-wide
 *     raceOptions/genderOptions, and a flavor select that fills in from flavorScopes once both
 *     are chosen.
 *
 * Saving never resends a field the moderator didn't touch: the route's own orExisting is what
 * makes that safe, and doing it here too is what lets "this is a tauren male" (no flavor
 * opinion) and "just the flavor" (client row, race/gender already right) both post a partial
 * answer instead of a full one.
 */
function SpeakerCell({
  npc,
  raceOptions,
  genderOptions,
  flavorScopes,
  busy,
  onSave,
}: {
  npc: NpcSummary;
  raceOptions: string[];
  genderOptions: string[];
  flavorScopes: FlavorScope[];
  busy: boolean;
  onSave: (answer: Partial<{ npcKind: NpcKind; race: string; gender: string; flavor: string; note: string }>) => void;
}) {
  const [race, setRace] = useState(npc.race ?? "");
  const [gender, setGender] = useState(npc.gender ?? "");
  const [flavor, setFlavor] = useState(npc.flavor ?? "");
  const [note, setNote] = useState("");
  // Only ever read for a kind-less row (npc.npcKind === null): NPC_KINDS's own values, "creature"
  // or "gameobject", picked by the moderator rather than guessed -- see NpcSummary's own
  // docstring for why resolveNpc refuses to make this guess itself.
  const [kind, setKind] = useState<NpcKind | "">("");
  // Only ever reachable for a `moderator` row (see below) -- a moderator's own settled answer
  // stays plain until they ask to change it, so an always-present form isn't one stray click
  // away from silently overwriting a considered "no race" with an empty save.
  const [editing, setEditing] = useState(false);

  if (npc.provenance === "corpus") {
    // The corpus is the exact answer, taken from the same display data the game itself uses --
    // there is nothing for a moderator to decide, and unlike a `moderator` row (below) there is
    // no "edit" affordance either: overriding the corpus's own answer would need to be a
    // deliberate act (e.g. direct SQL), not an accident of a form this table always shows.
    return (
      <>
        <span>{speaker(npc)}</span>
        <Badge variant="outline" className="ml-1 py-0 leading-5">
          corpus
        </Badge>
        {speakerNote(npc) ? <p className="text-muted-foreground mt-0.5">{speakerNote(npc)}</p> : null}
      </>
    );
  }

  if (npc.confirmed && !editing) {
    // A moderator's own settled answer (the only other `confirmed` provenance -- migration
    // 0031). Shown plainly like the corpus, but with a small edit control that reopens the form
    // below, preselected with the current values via the same useState initialisers above. The
    // store already lets a moderator write over a moderator row -- upsertResolution's `where`
    // compares ranks with `<=`, so an equal rank still updates (store.test.ts's "lets a
    // moderator write over a moderator row update") -- so nothing there needs to change for
    // this to work.
    return (
      <>
        <span>{speaker(npc)}</span>
        <Badge variant="outline" className="ml-1 py-0 leading-5">
          {npc.provenance}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          className="ml-1 h-5 px-1.5 py-0 text-xs"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        {speakerNote(npc) ? <p className="text-muted-foreground mt-0.5">{speakerNote(npc)}</p> : null}
      </>
    );
  }

  // `known` (race and gender already right, only the flavor is a guess) is specifically the
  // `client` provenance's own shape -- a moderator reopening their own row via Edit gets the
  // full race/gender/flavor selects below instead, since a moderator revising their own answer
  // may want to correct any of the three, not just the flavor.
  const known = npc.provenance === "client";
  // The "nothing known" state's own flavor options: flavorScopes is the whole corpus, so this
  // narrows to whatever race and gender were just picked, the same shape flavorOptions already
  // is for the "client" state -- there is no npc.flavorOptions to fall back on here because
  // page.tsx has no row-specific race/gender to have asked flavorsFor about.
  const flavorOptions = known
    ? npc.flavorOptions
    : flavorScopes.filter((scope) => scope.race === race && scope.gender === gender).map((scope) => scope.flavor);

  return (
    <div className="flex flex-col gap-1 py-1">
      <div className="flex flex-wrap items-center gap-1">
        {known ? (
          <span className="font-mono">
            {npc.race}-{npc.gender}-
          </span>
        ) : (
          <>
            {npc.npcKind === null ? (
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as NpcKind | "")}
                className="h-7 rounded border bg-transparent text-xs"
              >
                <option value="">kind?</option>
                {NPC_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : null}
            {/* No separator spans between these -- each select already reads as its own field
                (a border, a "race?"/"gender?" placeholder), and a bare `·`/`-` between them was
                clutter, not information, once the gap the flex row already gives them separates
                them just as clearly. */}
            <select
              value={race}
              onChange={(event) => {
                setRace(event.target.value);
                setFlavor("");
              }}
              className="h-7 rounded border bg-transparent text-xs"
            >
              <option value="">race?</option>
              {raceOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              value={gender}
              onChange={(event) => {
                setGender(event.target.value);
                setFlavor("");
              }}
              className="h-7 rounded border bg-transparent text-xs"
            >
              <option value="">gender?</option>
              {genderOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </>
        )}
        {known || (race && gender) ? (
          <select
            value={flavor}
            onChange={(event) => setFlavor(event.target.value)}
            className="h-7 rounded border bg-transparent text-xs"
          >
            <option value="">flavor?</option>
            {flavorOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : null}
        {/* `none` gets no badge: it is the provenance's own way of saying "we tried and learned
            nothing", which the form sitting right here already says -- see finding 5. `client`
            still earns one, since "a guess came from somewhere" is real information the form
            alone doesn't carry. */}
        {npc.provenance !== "none" ? (
          <Badge
            variant="outline"
            className="py-0 leading-5"
            // What `client` means, on hover rather than as a caption repeating the badge.
            title={npc.provenance === "client" ? "Guessed from the model the client reported" : undefined}
          >
            {npc.provenance}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {/* min-w-0 keeps a flex item's default content-sized min-width from forcing this input
            wider than the cell -- without it the placeholder ("why (e.g. a Wowhead link)") was
            what pushed the row past the column's old 14rem cap and got clipped at the edge. The
            merged NPC/Speaker column is also wider now (20rem, up from 14rem), giving the text
            itself room to read rather than just fit. */}
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="why (e.g. a Wowhead link)"
          className="h-7 min-w-0 flex-1 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          // A kind-less row with no kind picked yet has nothing valid to POST -- the route
          // requires npcKind and would 400 -- so the button waits rather than silently failing.
          disabled={busy || (npc.npcKind === null && !kind)}
          onClick={() => {
            // The "client" state never sends race/gender at all: leaving those keys off is what
            // tells the route to keep what the client already reported, rather than resending
            // (and risking retyping wrong) values this form doesn't even offer as inputs there.
            onSave(
              known
                ? { flavor, note }
                : { npcKind: kind || undefined, race, gender, flavor, note },
            );
            // Collapses back to the plain, settled view either way -- overrideNpc's own request
            // is fire-and-forget from here (see its "if (!response?.ok) return" silent no-op,
            // the same failure handling every other action in this table already has), so a
            // failed save leaves `npc` exactly as it was and this simply re-shows that answer
            // rather than a form now out of sync with it.
            setEditing(false);
          }}
        >
          Save
        </Button>
      </div>
      {speakerNote(npc) ? <p className="text-muted-foreground">{speakerNote(npc)}</p> : null}
    </div>
  );
}

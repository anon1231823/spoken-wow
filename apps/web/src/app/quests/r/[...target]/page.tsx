/**
 * Where the game's Report button sends a player.
 *
 * Not the explorer: someone arriving from the game is a player, not an editor. They see the
 * line, hear the take that is live, and file a report - nothing else.
 *
 * An address that resolves to nothing still renders the form. "The addon sent me to a page
 * that knows nothing about this quest" is information about the data module, and 404ing it
 * would throw that away.
 *
 * One catch-all segment serves both address shapes, so there is one page rather than two that
 * drift apart.
 */
import type { Metadata } from "next";
import Link from "next/link";

import ReportForm from "@/components/ReportForm";
import { audioRelPath } from "@/lib/audio";
import { currentVersion } from "@/lib/reports/current-version";
import { formatTarget, parseTarget, resolveTarget } from "@/lib/reports/target";

export const metadata: Metadata = { title: "Report a voice line · VoiceOver" };

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ target: string[] }>;
  searchParams: Promise<{ line?: string }>;
}) {
  const segments = (await params).target;
  const chosen = (await searchParams).line ?? null;
  const target = parseTarget(segments);

  if (!target) {
    return (
      <main className="mx-auto max-w-3xl px-5 pt-6 pb-24">
        <h1 className="text-xl font-semibold">Report a voice line</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          That address is not one this site understands, but you can still tell us about it.
        </p>
        <ReportForm target={segments.join("/")} lineId={null} />
      </main>
    );
  }

  const lines = resolveTarget(target);
  // One candidate needs no choosing; several mean the reporter picked one from the list below.
  const line =
    lines.find((candidate) => candidate.lineId === chosen) ?? (lines.length === 1 ? lines[0] : null);
  const version = line ? await currentVersion(audioRelPath(line)) : null;

  return (
    <main className="mx-auto max-w-3xl px-5 pt-6 pb-24">
      <h1 className="text-xl font-semibold">Report a voice line</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        You came here from the game. Tell us what sounded wrong and someone will listen to it.
      </p>

      {line ? (
        <section className="mb-6 rounded border p-4">
          <h2 className="font-medium">{line.questTitle ?? line.npcName}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {line.npcName} · {line.voice}
          </p>
          <p className="mt-2 text-sm whitespace-pre-wrap">{line.text}</p>
          <audio
            controls
            className="mt-3 w-full"
            src={`/api/quests/audio/${audioRelPath(line)}${version === null ? "" : `?v=${version}`}`}
          />
        </section>
      ) : null}

      {lines.length > 1 && !line ? (
        <section className="mb-6 rounded border p-4">
          <h2 className="font-medium">{lines[0].npcName}</h2>
          <p className="text-muted-foreground mt-1 mb-2 text-sm">
            This character has more than one line. Which one sounded wrong?
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {lines.map((candidate) => (
              <li key={candidate.lineId}>
                <Link
                  href={`/quests/r/${formatTarget(target)}?line=${encodeURIComponent(candidate.lineId)}`}
                  className="underline-offset-2 hover:underline"
                >
                  {candidate.text.slice(0, 120)}
                  {candidate.text.length > 120 ? "…" : ""}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lines.length === 0 ? (
        <p className="text-muted-foreground mb-6 text-sm">
          Nothing in the corpus matches that address. File the report anyway — an address that
          resolves to nothing is worth knowing about.
        </p>
      ) : null}

      <ReportForm target={formatTarget(target)} lineId={line?.lineId ?? null} />
    </main>
  );
}

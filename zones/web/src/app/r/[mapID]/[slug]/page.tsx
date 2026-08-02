import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackForm } from "@/components/FeedbackForm";
import { audioRelPath } from "@/lib/audio";
import { lineByPath, loadContext } from "@/lib/catalogue";

/**
 * One line, and the form to complain about it.
 *
 * Where the addon's Report button sends people. The client cannot open a URL or post
 * anywhere, so what it can offer is an address to copy, and this is the page at the end
 * of it: the line they were just reading, the narration they were just hearing, and the
 * form -- already pointed at the right line, which is the whole saving over telling them
 * to go and find it among 1353 rows in the explorer.
 *
 * Deliberately not the explorer. Someone arriving from the game is a player, not an
 * editor; flags, takes, staleness and the regenerate controls are answers to questions
 * they did not ask, and the explorer's paging means an arbitrary line is not reliably on
 * the first screen anyway.
 *
 * The address is /r/{mapID}/{slug} -- the same path the line's audio file uses -- because
 * the addon can build that from what it already has, with no per-line table and nothing
 * to escape. See ZoneLore:ReportURL in addon/ZoneLore/Core.lua.
 */

type Params = { mapID: string; slug: string };

async function resolve({ mapID, slug }: Params) {
  return lineByPath(Number(mapID), slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const entry = await resolve(await params);
  // notFound() belongs in the page, not here; this just declines to name a title.
  if (!entry) return {};
  return {
    title: entry.name,
    description: `Report a problem with the ZoneLore entry for ${entry.name}.`,
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const entry = await resolve(await params);
  if (!entry) notFound();

  // The current take is the only thing here that is not derivable from committed files,
  // and it answers one question: is there narration to listen to before complaining
  // about it.
  const take = (await loadContext()).takes.get(entry.id);

  return (
    <main className="shell pt-8 pb-24">
      <article className="max-w-2xl">
        <h1 className="text-xl font-semibold">{entry.name}</h1>
        <p className="mt-1 text-muted">
          {entry.kind === "subzone" ? `in ${entry.zoneName}` : "zone lore"}
        </p>

        {take ? (
          // The native control, not components/Player.tsx: that one carries a download
          // button, a rate selector and keyboard wiring built for an editor working
          // through a list. Here there is one clip and one reason to play it.
          <audio
            controls
            preload="metadata"
            className="mt-4 w-full"
            // The take version busts the browser cache after a regeneration; without it
            // someone sent back to check a fix would hear the clip they complained about.
            src={`/api/audio/${audioRelPath(entry.file)}?v=${take.version}`}
          />
        ) : (
          <p className="mt-4 text-sm text-faint">
            This entry has no narration yet — the addon plays a placeholder for it.
          </p>
        )}

        <p className="mt-5 whitespace-pre-line">{entry.full}</p>

        <section className="mt-8 rounded-lg border border-border bg-panel p-4">
          <h2 className="font-medium">Report a problem</h2>
          <p className="mt-1 mb-3 text-xs text-faint">
            Wrong lore, a bad reading, a mispronounced name. It goes to the editors.
          </p>
          <FeedbackForm target={{ id: entry.id, name: entry.name, zoneName: entry.zoneName }} />
        </section>

        <footer className="mt-8 text-sm text-muted">
          <Link href={`/?zone=${entry.mapID}`} className="hover:text-fg">
            Browse every line in {entry.zoneName} →
          </Link>
          <p className="mt-2 text-xs text-faint">
            Lore: {entry.source ? <a href={entry.source}>warcraft.wiki.gg</a> : "warcraft.wiki.gg"}{" "}
            (CC BY-SA 4.0)
          </p>
        </footer>
      </article>
    </main>
  );
}

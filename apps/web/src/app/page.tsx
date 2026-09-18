import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Spoken" };

/**
 * The front door.
 *
 * Three sections, named by what they voice rather than by which project they came from: a
 * visitor does not know that one of these used to be at voiceover.rusty.one and another at
 * lore.rusty.one, and should not have to.
 */
const SECTIONS = [
  {
    href: "/quests",
    title: "Quest dialogue",
    blurb:
      "Every line an NPC speaks when you take, hand in or ask about a quest, and the gossip " +
      "in between. Extracted from the game, voiced per race, gender and flavour.",
    detail: "17,507 lines · 54 voices",
  },
  {
    href: "/zones",
    title: "Zone lore",
    blurb:
      "The prose the addon reads when you walk into a place, for every zone and subzone. " +
      "Written rather than extracted: scraped from the wiki, and correctable here.",
    detail: "1,353 lines · one narrator",
  },
  {
    href: "/books",
    title: "Books and notes",
    blurb:
      "Every book, letter, note and plaque the game will show you, page by page. " +
      "Blizzard's words again, read by the narrator rather than by the NPC who hands them over.",
    detail: "1,191 pages · 404 books",
  },
];

export default function Page() {
  return (
    <main className="mx-auto max-w-4xl px-5 pt-10 pb-24">
      <h1 className="text-2xl font-semibold">Spoken</h1>
      <p className="text-muted-foreground mt-2 mb-8 max-w-2xl text-sm">
        Voiced dialogue, lore and text for World of Warcraft Classic. Browse and play every
        line the addons ship, search for the one you heard, and tell us when one is wrong.
      </p>

      {/* Three columns once there is room, so the third card does not sit alone on a row
          of its own. Two below that, one on a phone. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="hover:bg-accent rounded-lg border p-5 transition-colors"
          >
            <h2 className="font-medium">{section.title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{section.blurb}</p>
            <p className="text-muted-foreground mt-3 text-xs">{section.detail}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}

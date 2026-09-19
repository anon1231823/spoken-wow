import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Spoken" };

const CURSEFORGE = "https://www.curseforge.com/wow/addons";
const WAGO = "https://addons.wago.io/addons";

/**
 * The front door.
 *
 * Three sections, named by what they voice rather than by which project they came from: a
 * visitor does not know that one of these used to be at voiceover.rusty.one and another at
 * lore.rusty.one, and should not have to.
 *
 * Each card carries the addon's own icon, the same art CurseForge and the in-game addon
 * list show, so somebody arriving from either recognises what they came for. They are the
 * exported SVGs from pipelines/*, copied into public/icons/ -- see the note there.
 *
 * The store links sit BELOW the card rather than inside it, and that is structural
 * rather than aesthetic: the card is one big anchor, and an anchor inside an anchor is
 * invalid HTML that browsers resolve by closing the outer one early.
 *
 * TWO STORES, AND NOT EVERY ADDON IS ON BOTH. The slugs are identical on CurseForge and
 * Wago, so one slug addresses both -- but a sound pack is 300-450 MB and Wago's upload
 * endpoint refuses anything that size, so the packs are CurseForge-only and say so here
 * rather than offering a Wago link that 404s. `wago: false` is that fact, not a preference.
 */
const SECTIONS = [
  {
    href: "/quests",
    icon: "/icons/quests.svg",
    title: "Quest dialogue",
    blurb:
      "Every line an NPC speaks when you take, hand in or ask about a quest, and the gossip " +
      "in between. Extracted from the game, voiced per race, gender and flavour.",
    detail: "17,507 lines · 54 voices",
    addons: [
      { slug: "spoken-quests", label: "Spoken Quests", wago: true },
      { slug: "spoken-quests-audio-all", label: "Audio: All", wago: true },
    ],
    // The other four packs are Alliance, Horde, Shared and Gossip. They are listed on the
    // All pack's own page, which is where somebody choosing between them should be reading
    // anyway -- the choice is about download size, and that page is where the sizes are.
    addonsNote: "Alliance, Horde, Shared and Gossip packs on the All page",
  },
  {
    href: "/zones",
    icon: "/icons/zones.svg",
    title: "Zone lore",
    blurb:
      "The prose the addon reads when you walk into a place, for every zone and subzone. " +
      "Written rather than extracted: scraped from the wiki, and correctable here.",
    detail: "1,353 lines · one narrator",
    addons: [
      { slug: "spoken-zones", label: "Spoken Zones", wago: true },
      { slug: "spoken-zones-audio", label: "Spoken Zones Audio", wago: false },
    ],
  },
  {
    href: "/books",
    icon: "/icons/books.svg",
    title: "Books and notes",
    blurb:
      "Every book, letter, note and plaque the game will show you, page by page. " +
      "Blizzard's words again, read by the narrator rather than by the NPC who hands them over.",
    detail: "1,191 pages · 404 books",
    addons: [
      { slug: "spoken-books", label: "Spoken Books", wago: true },
      { slug: "spoken-books-audio", label: "Spoken Books Audio", wago: false },
    ],
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
          of its own. Two below that, one on a phone.

          items-start, so a cell whose links wrap to a second line does not stretch its
          neighbours: the cards stay the same height as each other and the link rows below
          them are free to differ. */}
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <div key={section.href}>
            <Link
              href={section.href}
              className="hover:bg-accent block h-full rounded-lg border p-5 transition-colors"
            >
              {/* Plain img, not next/image: these are fixed-size SVGs, which the image
                  optimiser passes through untouched, and the standalone server would want
                  sharp installed to do even that. */}
              <img
                src={section.icon}
                alt=""
                width={40}
                height={40}
                className="mb-3 h-10 w-10"
              />
              <h2 className="font-medium">{section.title}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{section.blurb}</p>
              <p className="text-muted-foreground mt-3 text-xs">{section.detail}</p>
            </Link>

            <div className="mt-2 px-1 text-xs">
              {/* One row per addon, the name plain and the stores beside it. The name used to
                  be the CurseForge link itself, which stopped working the moment there were
                  two stores: a single anchor cannot say "this addon, over there, twice". */}
              {section.addons.map((addon) => (
                <p key={addon.slug} className="text-muted-foreground">
                  {addon.label}
                  <span className="px-1.5">·</span>
                  <a
                    href={`${CURSEFORGE}/${addon.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground underline underline-offset-2"
                  >
                    CurseForge
                  </a>
                  {addon.wago && (
                    <>
                      <span className="px-1.5">·</span>
                      <a
                        href={`${WAGO}/${addon.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground underline underline-offset-2"
                      >
                        Wago
                      </a>
                    </>
                  )}
                </p>
              ))}
              {section.addonsNote && (
                <p className="text-muted-foreground/70 mt-1">{section.addonsNote}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

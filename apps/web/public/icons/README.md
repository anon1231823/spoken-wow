# Section icons

The three addon icons the landing page puts on its cards. The same art CurseForge
and the in-game addon list show, so somebody arriving from either recognises what
they came for.

Copied, not authored. The sources are the exported SVGs beside each pipeline's
other assets:

| Here | From |
|---|---|
| `quests.svg` | `pipelines/quests/assets/icon/spoken-quests.svg` |
| `zones.svg` | `pipelines/zones/assets/spoken-zones.svg` |
| `books.svg` | `pipelines/books/assets/spoken-books.svg` |

Two things were done to them on the way in, and both should be done again if one is
re-exported:

- **The C2PA provenance blob is stripped.** The books export carried ~8 KB of it in a
  `<metadata>` element, which is most of the file at this size.
- **Gradient ids are namespaced** — `gold` became `books-gold`, and so on. Served as
  separate documents they cannot collide, but all three declare the same ids, so
  inlining two of them into one page would hand both the last one's gradient. The
  prefix costs nothing and removes the trap.

SVG rather than the 512px PNGs beside them: these render at 40px, and a vector is
both smaller and sharp on a retina display without a second file.

`public/` is not part of Next's standalone output, so
`.github/workflows/deploy-web.yaml` copies this directory into the release
explicitly. A new file here needs no change to that; a new directory beside it does
not either, but the smoke test that proves the copy happened names one of these
files.
